const http = require("node:http");
const { randomUUID } = require("node:crypto");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const { getCase, scoreDiagnosis } = require("./src/diagnostics");
const {
  generatePatientReply,
  synthesizeSpeech,
} = require("./src/providers");

const publicDirectory = path.join(__dirname, "public");
const sessions = new Map();
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
      speechModelConfigured: Boolean(process.env.ELEVENLABS_API_KEY),
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/sessions") {
    const caseData = getCase("migraine");
    const sessionId = randomUUID();
    sessions.set(sessionId, { caseId: caseData.id, history: [] });
    sendJson(response, 201, {
      sessionId,
      patient: {
        name: caseData.patient.name,
        age: caseData.patient.age,
        opening: caseData.patient.opening,
      },
      caseTitle: caseData.title,
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
    const reply = await generatePatientReply(getCase(session.caseId), history);
    session.history = [...history, { role: "assistant", content: reply }].slice(
      -maxHistoryTurns,
    );
    sendJson(response, 200, { reply });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/speech") {
    const body = await readJson(request);
    if (typeof body.text !== "string" || !body.text.trim()) {
      sendJson(response, 400, { error: "Speech text is required." });
      return;
    }
    if (body.text.length > 2_000) {
      sendJson(response, 400, { error: "Speech text must be 2,000 characters or fewer." });
      return;
    }
    const audio = await synthesizeSpeech(body.text.trim());
    response.writeHead(200, {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    });
    response.end(audio);
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
      scoreDiagnosis(getCase(session.caseId), body.diagnosis, session.history),
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

const port = Number(process.env.PORT || 3000);
server.listen(port, () => {
  console.log(`Diagnostic simulator available at http://localhost:${port}`);
});
