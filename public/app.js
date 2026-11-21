const caseScreen = document.querySelector("#case-screen");
const encounterScreen = document.querySelector("#encounter-screen");
const diagnosisScreen = document.querySelector("#diagnosis-screen");
const seePatientButton = document.querySelector("#see-patient");
const timerChip = document.querySelector("#timer-chip");
const timerDisplay = document.querySelector("#timer");
const chatForm = document.querySelector("#chat-form");
const chatInput = document.querySelector("#chat-input");
const sendButton = document.querySelector("#send-button");
const waveform = document.querySelector("#waveform");
const speechStatus = document.querySelector("#speech-status");
const toast = document.querySelector("#toast");
const diagnosisForm = document.querySelector("#diagnosis-form");
const diagnosisInput = document.querySelector("#diagnosis-input");
const diagnosisButton = document.querySelector("#diagnosis-button");
const result = document.querySelector("#result");

const interviewDuration = 15 * 60;
let sessionId;
let remainingSeconds = interviewDuration;
let timerInterval;
let toastTimeout;
let voiceSocket;
let voiceReady = false;
let microphoneStream;
let audioContext;
let microphoneSource;
let captureNode;
let silentOutput;
let agentAudioSources = new Set();
let scheduledAudioTime = 0;
let requestPending = false;
let phase = "file";

for (let index = 0; index < 40; index += 1) {
  const bar = document.createElement("span");
  bar.className = "wave-bar";
  bar.style.setProperty("--bar-index", index);
  bar.style.setProperty("--bar-height", `${7 + ((index * 13) % 25)}px`);
  waveform.append(bar);
}

function showError(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.add("hidden"), 7000);
}

async function requestJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "The request could not be completed.");
  }
  return data;
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function updateTimer() {
  timerDisplay.textContent = formatTime(remainingSeconds);
  timerChip.classList.toggle("timer-warning", remainingSeconds <= 60);
}

function setPatientStatus(message, mode = "") {
  speechStatus.textContent = message;
  waveform.classList.toggle("is-speaking", mode === "speaking");
  waveform.classList.toggle("is-thinking", mode === "thinking");
  document.querySelector(".wave-stage").classList.toggle("patient-speaking", mode === "speaking");
}

function stopAgentAudio() {
  for (const source of agentAudioSources) {
    source.onended = null;
    source.stop();
    source.disconnect();
  }
  agentAudioSources.clear();
  scheduledAudioTime = 0;
}

function playAgentAudio(arrayBuffer) {
  if (!audioContext || arrayBuffer.byteLength % 2 !== 0) return;
  const pcm = new Int16Array(arrayBuffer);
  const samples = new Float32Array(pcm.length);
  for (let index = 0; index < pcm.length; index += 1) {
    samples[index] = pcm[index] / (pcm[index] < 0 ? 32768 : 32767);
  }

  const buffer = audioContext.createBuffer(1, samples.length, 24000);
  buffer.copyToChannel(samples, 0);
  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(audioContext.destination);
  source.onended = () => {
    agentAudioSources.delete(source);
    source.disconnect();
  };
  const startAt = Math.max(audioContext.currentTime + 0.02, scheduledAudioTime);
  source.start(startAt);
  scheduledAudioTime = startAt + buffer.duration;
  agentAudioSources.add(source);
  setPatientStatus("Patient is speaking…", "speaking");
}

function startMicrophoneCapture() {
  if (!microphoneStream || !audioContext || captureNode) return;
  microphoneSource = audioContext.createMediaStreamSource(microphoneStream);
  captureNode = new AudioWorkletNode(audioContext, "pcm16-capture", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 1,
    channelCountMode: "explicit",
    outputChannelCount: [1],
  });
  silentOutput = audioContext.createGain();
  silentOutput.gain.value = 0;
  captureNode.port.onmessage = ({ data }) => {
    if (
      voiceReady &&
      voiceSocket?.readyState === WebSocket.OPEN &&
      voiceSocket.bufferedAmount < 256_000
    ) {
      voiceSocket.send(data);
    }
  };
  microphoneSource.connect(captureNode);
  captureNode.connect(silentOutput);
  silentOutput.connect(audioContext.destination);
}

function handleVoiceEvent(event) {
  if (event.type === "SettingsApplied") {
    voiceReady = true;
    startMicrophoneCapture();
    setPatientStatus("Connected — speak naturally or type a message");
    sendButton.disabled = false;
    return;
  }
  if (event.type === "Error") {
    const message = event.description || event.message || "Voice session failed.";
    showError(message);
    setPatientStatus("Voice session error");
    if (!voiceReady) throw new Error(message);
    return;
  }
  if (event.type === "Warning") {
    const code = event.code ? `${event.code}: ` : "";
    showError(`${code}${event.description || event.message || "Deepgram reported a warning."}`);
    return;
  }
  if (event.type === "UserStartedSpeaking") {
    stopAgentAudio();
    setPatientStatus("Listening to you…", "thinking");
    return;
  }
  if (event.type === "AgentThinking") {
    setPatientStatus("Patient is thinking…", "thinking");
    return;
  }
  if (event.type === "AgentStartedSpeaking") {
    setPatientStatus("Patient is speaking…", "speaking");
    return;
  }
  if (event.type === "ConversationText") {
    if (event.role === "user") {
      setPatientStatus(`You: ${event.content}`);
    } else if (event.role === "assistant") {
      setPatientStatus(`Patient: ${event.content}`);
    }
    return;
  }
  if (event.type === "AgentAudioDone") {
    setPatientStatus("Listening — speak naturally or type a message");
    sendButton.disabled = false;
  }
}

async function startVoiceSession() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This browser does not support microphone access.");
  }

  microphoneStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  audioContext = new AudioContext({ sampleRate: 16000 });
  if (audioContext.sampleRate !== 16000) {
    throw new Error("This browser could not open 16 kHz audio for the voice call.");
  }
  await audioContext.audioWorklet.addModule("/pcm-capture.js");
  await audioContext.resume();

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  const socketUrl = `${protocol}//${location.host}/api/voice?sessionId=${encodeURIComponent(sessionId)}`;
  voiceSocket = new WebSocket(socketUrl);
  voiceSocket.binaryType = "arraybuffer";

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Timed out connecting to the voice agent.")),
      20_000,
    );
    voiceSocket.addEventListener("message", (message) => {
      if (typeof message.data !== "string") {
        playAgentAudio(message.data);
        return;
      }
      let event;
      try {
        event = JSON.parse(message.data);
      } catch {
        clearTimeout(timeout);
        reject(new Error("Received an invalid voice-agent event."));
        return;
      }
      try {
        handleVoiceEvent(event);
      } catch (error) {
        clearTimeout(timeout);
        reject(error);
        return;
      }
      if (event.type === "SettingsApplied") {
        clearTimeout(timeout);
        resolve();
      }
    });
    voiceSocket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("Could not connect to the voice agent."));
    });
    voiceSocket.addEventListener("close", () => {
      clearTimeout(timeout);
      voiceReady = false;
      if (phase === "interview") {
        setPatientStatus("Voice session disconnected");
      }
      reject(new Error("The voice-agent connection closed before setup completed."));
    });
  });
}

function stopVoiceSession() {
  voiceReady = false;
  stopAgentAudio();
  if (captureNode) {
    captureNode.port.onmessage = null;
    captureNode.disconnect();
    captureNode = undefined;
  }
  if (microphoneSource) {
    microphoneSource.disconnect();
    microphoneSource = undefined;
  }
  if (silentOutput) {
    silentOutput.disconnect();
    silentOutput = undefined;
  }
  if (microphoneStream) {
    for (const track of microphoneStream.getTracks()) track.stop();
    microphoneStream = undefined;
  }
  if (audioContext) {
    void audioContext.close();
    audioContext = undefined;
  }
  if (voiceSocket && voiceSocket.readyState < WebSocket.CLOSING) {
    voiceSocket.close(1000, "Interview ended");
  }
  voiceSocket = undefined;
}

async function loadCaseFile() {
  stopVoiceSession();
  phase = "file";
  clearInterval(timerInterval);
  timerInterval = undefined;
  remainingSeconds = interviewDuration;
  updateTimer();
  timerChip.classList.add("hidden");
  encounterScreen.classList.add("hidden");
  diagnosisScreen.classList.add("hidden");
  caseScreen.classList.remove("hidden");
  seePatientButton.disabled = true;
  chatInput.value = "";
  document.querySelector("#notes").value = "";
  diagnosisInput.value = "";
  diagnosisForm.classList.remove("hidden");
  result.replaceChildren();
  result.classList.add("hidden");
  try {
    const data = await requestJson("/api/sessions", {});
    sessionId = data.sessionId;
    document.querySelector("#patient-name").textContent = data.patient.name;
    document.querySelector("#patient-age").textContent = data.patient.age
      ? `${data.patient.age} years`
      : "Not provided";
    document.querySelector("#patient-sex").textContent = data.patient.sex;
    document.querySelector("#reason-for-visit").textContent =
      data.patient.reasonForVisit;
    document.querySelector("#patient-initials").textContent = data.patient.name
      .split(/\s+/)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
    const conditions = document.querySelector("#previous-conditions");
    conditions.replaceChildren();
    for (const condition of data.patient.previousConditions) {
      const item = document.createElement("li");
      item.textContent = condition;
      conditions.append(item);
    }
    seePatientButton.disabled = false;
  } catch (error) {
    showError(error.message);
  }
}

async function beginInterview() {
  if (!sessionId || phase !== "file") return;
  phase = "interview";
  caseScreen.classList.add("hidden");
  diagnosisScreen.classList.add("hidden");
  encounterScreen.classList.remove("hidden");
  timerChip.classList.remove("hidden");
  document.querySelector("#encounter-title").textContent = "Your consultation";
  remainingSeconds = interviewDuration;
  updateTimer();
  sendButton.disabled = true;
  setPatientStatus("Connecting to the voice agent…", "thinking");

  try {
    await startVoiceSession();
  } catch (error) {
    stopVoiceSession();
    phase = "file";
    encounterScreen.classList.add("hidden");
    timerChip.classList.add("hidden");
    caseScreen.classList.remove("hidden");
    seePatientButton.disabled = false;
    setPatientStatus("Ready when you are");
    showError(error.message);
    return;
  }

  timerInterval = setInterval(() => {
    remainingSeconds -= 1;
    updateTimer();
    if (remainingSeconds <= 0) finishInterview(true);
  }, 1000);
}

function finishInterview(timeExpired = false) {
  if (phase !== "interview") return;
  phase = "diagnosis";
  clearInterval(timerInterval);
  timerInterval = undefined;
  stopVoiceSession();
  timerChip.classList.add("hidden");
  encounterScreen.classList.add("hidden");
  caseScreen.classList.add("hidden");
  diagnosisScreen.classList.remove("hidden");
  if (timeExpired) {
    showError("Your 15-minute interview is over. Submit your diagnosis to finish.");
  }
  diagnosisInput.focus();
}

async function submitQuestion(event) {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message || !sessionId || phase !== "interview" || requestPending) return;

  requestPending = true;
  chatInput.value = "";
  chatInput.style.height = "auto";
  sendButton.disabled = true;
  try {
    if (!voiceReady || voiceSocket?.readyState !== WebSocket.OPEN) {
      throw new Error("The voice agent is not connected. Start a new interview and try again.");
    }
    stopAgentAudio();
    voiceSocket.send(JSON.stringify({ type: "InjectUserMessage", content: message }));
    setPatientStatus("Sending your message…", "thinking");
  } catch (error) {
    setPatientStatus("Ready when you are", "");
    sendButton.disabled = false;
    showError(error.message);
  } finally {
    requestPending = false;
  }
}

function renderResults(data) {
  result.replaceChildren();
  const thankYou = document.createElement("p");
  thankYou.textContent = `Thank you for speaking with ${document.querySelector("#patient-name").textContent}. Your encounter is complete.`;
  const score = document.createElement("div");
  score.className = "result-score";
  score.textContent = `${data.score}/100`;
  const categoryScores = document.createElement("ul");
  categoryScores.className = "category-scores";
  const categoryLabels = {
    diagnosis: "Diagnosis",
    clinicalReasoning: "Clinical reasoning",
    differentialAndExclusion: "Differential & exclusion",
    evidenceGathering: "Evidence gathering",
  };
  for (const [category, label] of Object.entries(categoryLabels)) {
    const item = document.createElement("li");
    item.textContent = `${label}: ${data.categoryScores[category]}/${
      { diagnosis: 35, clinicalReasoning: 25, differentialAndExclusion: 30, evidenceGathering: 10 }[category]
    }`;
    categoryScores.append(item);
  }
  const feedback = document.createElement("p");
  feedback.textContent = data.summary;
  const expected = document.createElement("p");
  expected.className = "expected";
  expected.textContent = `Diagnosis assessment: ${data.diagnosisAssessment}`;
  const resultItems = [thankYou, score, categoryScores, feedback, expected];

  if (data.differentials.length) {
    const heading = document.createElement("h3");
    heading.textContent = "Relevant alternatives";
    const differentials = document.createElement("ul");
    differentials.className = "differential-list";
    for (const differential of data.differentials) {
      const item = document.createElement("li");
      item.textContent = `${differential.diagnosis} (${differential.relevance}; ${differential.status}) — ${differential.evidence} Next: ${differential.nextStep}`;
      differentials.append(item);
    }
    resultItems.push(heading, differentials);
  }
  for (const [title, entries] of [
    ["What you did well", data.strengths],
    ["What to improve", data.improvements],
  ]) {
    if (!entries.length) continue;
    const heading = document.createElement("h3");
    heading.textContent = title;
    const list = document.createElement("ul");
    for (const entry of entries) {
      const item = document.createElement("li");
      item.textContent = entry;
      list.append(item);
    }
    resultItems.push(heading, list);
  }
  const newCaseButton = document.createElement("button");
  newCaseButton.className = "quiet-button result-new-case";
  newCaseButton.type = "button";
  newCaseButton.textContent = "Start a new case";
  newCaseButton.addEventListener("click", loadCaseFile);
  result.append(...resultItems, newCaseButton);
  result.classList.remove("hidden");
  diagnosisForm.classList.add("hidden");
}

async function submitDiagnosis(event) {
  event.preventDefault();
  if (!sessionId || phase !== "diagnosis" || diagnosisButton.disabled) return;
  diagnosisButton.disabled = true;
  try {
    const data = await requestJson("/api/diagnosis", {
      sessionId,
      diagnosis: diagnosisInput.value.trim(),
      notes: document.querySelector("#notes").value,
    });
    renderResults(data);
  } catch (error) {
    showError(error.message);
  } finally {
    diagnosisButton.disabled = false;
  }
}

chatForm.addEventListener("submit", submitQuestion);
chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    chatForm.requestSubmit();
  }
});
chatInput.addEventListener("input", () => {
  chatInput.style.height = "auto";
  chatInput.style.height = `${Math.min(chatInput.scrollHeight, 110)}px`;
});
seePatientButton.addEventListener("click", beginInterview);
document.querySelector("#diagnose-finish").addEventListener("click", () => finishInterview());
diagnosisForm.addEventListener("submit", submitDiagnosis);
document.querySelector("#new-case").addEventListener("click", loadCaseFile);

loadCaseFile();
