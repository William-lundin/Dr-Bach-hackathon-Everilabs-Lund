const http = require("node:http");
const { randomUUID } = require("node:crypto");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { WebSocket, WebSocketServer } = require("ws");
const { getCase, scoreDiagnosis } = require("./src/diagnostics");
const { createPatientDataset } = require("./src/patient-dataset");
const { generatePatientReply } = require("./src/providers");
const { buildVoiceAgentConfiguration } = require("./src/deepgram-voice");

const publicDirectory = path.join(__dirname, "public");
const sessions = new Map();
const getRandomPatientCase = createPatientDataset();
const voiceServer = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
const deepgramVoiceUrl = "wss://agent.deepgram.com/v1/agent/converse";
const maxHistoryTurns = 24;
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 16_384) {
      throw new Error("Request body is too large.");
    }
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

async function serveStatic(pathname, response) {
  const relativePath =
    pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const filePath = path.resolve(publicDirectory, relativePath);
  if (!filePath.startsWith(`${publicDirectory}${path.sep}`)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  try {
    const content = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type":
        mimeTypes[path.extname(filePath)] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(content);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}

async function handleRequest(request, response) {
  const url = new URL(request.url, "http://localhost");
  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, {
      status: "ok",
      patientModelConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
      voiceAgentConfigured: Boolean(
        process.env.DEEPGRAM_API_KEY && process.env.ANTHROPIC_API_KEY,
      ),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/sessions") {
    const caseData =
      (await getRandomPatientCase()) || getCase("migraine");
    const sessionId = randomUUID();
    sessions.set(sessionId, {
      caseData,
      history: [{ role: "assistant", content: caseData.patient.opening }],
    });
    sendJson(response, 201, {
      sessionId,
      patient: {
        name: caseData.patient.name,
        age: caseData.patient.age,
        sex: caseData.patient.sex,
        reasonForVisit: caseData.patient.reasonForVisit,
        previousConditions: caseData.patient.previousConditions,
        opening: caseData.patient.opening,
      },
      caseTitle: caseData.title || caseData.patient.name,
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/chat") {
    const body = await readJson(request);
    const session = sessions.get(body.sessionId);
    if (!session) {
      sendJson(response, 404, { error: "Interview session not found." });
      return;
    }
    if (typeof body.message !== "string" || !body.message.trim()) {
      sendJson(response, 400, { error: "A non-empty message is required." });
      return;
    }
    if (body.message.length > 2_000) {
      sendJson(response, 400, { error: "Message must be 2,000 characters or fewer." });
      return;
    }

    const studentTurn = { role: "user", content: body.message.trim() };
    const history = [...session.history, studentTurn].slice(-maxHistoryTurns);
    const reply = await generatePatientReply(session.caseData, history);
    session.history = [...history, { role: "assistant", content: reply }].slice(
      -maxHistoryTurns,
    );
    sendJson(response, 200, { reply });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/diagnosis") {
    const body = await readJson(request);
    const session = sessions.get(body.sessionId);
    if (!session) {
      sendJson(response, 404, { error: "Interview session not found." });
      return;
    }
    if (
      typeof body.diagnosis !== "string" ||
      !body.diagnosis.trim() ||
      body.diagnosis.length > 500
    ) {
      sendJson(response, 400, {
        error: "Enter a diagnosis of 1 to 500 characters.",
      });
      return;
    }
    sendJson(
      response,
      200,
      scoreDiagnosis(session.caseData, body.diagnosis, session.history),
    );
    return;
  }

  if (request.method === "GET") {
    await serveStatic(url.pathname, response);
    return;
  }
  sendJson(response, 404, { error: "Route not found." });
}

const server = http.createServer((request, response) => {
  handleRequest(request, response).catch((error) => {
    console.error("Request failed:", error.message);
    if (!response.headersSent) {
      const status =
        error.statusCode ||
        (error.message.includes("_API_KEY is not configured") ? 503 : 502);
      sendJson(response, status, {
        error: error.message,
      });
    } else {
      response.destroy(error);
    }
  });
});

function sendVoiceError(socket, message) {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "Error", description: message }));
    socket.close(1011, "Voice agent error");
  }
}

function recordConversationText(session, event) {
  if (
    event.type !== "ConversationText" ||
    !["user", "assistant"].includes(event.role) ||
    typeof event.content !== "string" ||
    !event.content.trim()
  ) {
    return;
  }

  const turn = { role: event.role, content: event.content.trim() };
  const previous = session.history.at(-1);
  if (previous?.role === turn.role && previous.content === turn.content) return;
  session.history = [...session.history, turn].slice(-maxHistoryTurns);
}

voiceServer.on("connection", (client, request) => {
  const url = new URL(request.url, "http://localhost");
  const session = sessions.get(url.searchParams.get("sessionId"));
  if (!session) {
    sendVoiceError(client, "Interview session not found.");
    return;
  }

  let configuration;
  try {
    configuration = buildVoiceAgentConfiguration(session.caseData);
  } catch (error) {
    sendVoiceError(client, error.message);
    return;
  }

  const agent = new WebSocket(deepgramVoiceUrl, {
    headers: { Authorization: `Token ${configuration.apiKey}` },
    maxPayload: 1024 * 1024,
  });
  let settingsApplied = false;

  agent.on("message", (data, isBinary) => {
    if (!isBinary) {
      let event;
      try {
        event = JSON.parse(data.toString());
      } catch {
        sendVoiceError(client, "Deepgram sent an invalid voice-agent message.");
        agent.close();
        return;
      }

      if (event.type === "Welcome") {
        agent.send(JSON.stringify(configuration.settings));
      } else if (event.type === "SettingsApplied") {
        settingsApplied = true;
      } else if (event.type === "ConversationText") {
        recordConversationText(session, event);
      } else if (event.type === "Error") {
        console.error(
          "Deepgram Voice Agent error:",
          event.code || "UNKNOWN",
          event.description || event.message,
        );
      } else if (event.type === "Warning") {
        console.warn(
          "Deepgram Voice Agent warning:",
          event.code || "UNKNOWN",
          event.description || event.message,
        );
      }
    }

    if (client.readyState === WebSocket.OPEN) {
      client.send(data, { binary: isBinary });
    }
  });

  agent.on("error", () => {
    sendVoiceError(
      client,
      "Could not connect to Deepgram Voice Agent. Check the Deepgram key and model settings.",
    );
  });

  agent.on("close", (code) => {
    if (client.readyState === WebSocket.OPEN) {
      client.close(code === 1000 || code === 1001 ? code : 1011);
    }
  });

  client.on("message", (data, isBinary) => {
    if (agent.readyState !== WebSocket.OPEN || !settingsApplied) {
      sendVoiceError(client, "Voice agent is not ready to receive input.");
      return;
    }
    if (isBinary) {
      agent.send(data, { binary: true });
      return;
    }

    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      sendVoiceError(client, "Voice input must be valid JSON.");
      return;
    }
    if (
      message.type !== "InjectUserMessage" ||
      typeof message.content !== "string" ||
      !message.content.trim() ||
      message.content.length > 2_000
    ) {
      sendVoiceError(client, "Only non-empty text messages up to 2,000 characters are accepted.");
      return;
    }
    agent.send(
      JSON.stringify({
        type: "InjectUserMessage",
        content: message.content.trim(),
      }),
    );
  });

  client.on("close", () => {
    if (agent.readyState === WebSocket.OPEN || agent.readyState === WebSocket.CONNECTING) {
      agent.close();
    }
  });
});

server.on("upgrade", (request, socket, head) => {
  let url;
  let origin;
  try {
    if (!request.headers.host || !request.headers.origin) throw new Error();
    url = new URL(request.url, `http://${request.headers.host}`);
    origin = new URL(request.headers.origin);
  } catch {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }
  if (url.pathname !== "/api/voice") {
    socket.destroy();
    return;
  }

  if (origin.host !== request.headers.host) {
    socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return;
  }

  voiceServer.handleUpgrade(request, socket, head, (client) => {
    voiceServer.emit("connection", client, request);
  });
});

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
  console.log(`Diagnostic simulator available at http://localhost:${port}`);
});
