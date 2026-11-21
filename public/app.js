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
const replayButton = document.querySelector("#replay-button");
const toast = document.querySelector("#toast");
const diagnosisForm = document.querySelector("#diagnosis-form");
const diagnosisInput = document.querySelector("#diagnosis-input");
const diagnosisButton = document.querySelector("#diagnosis-button");
const result = document.querySelector("#result");

const interviewDuration = 15 * 60;
let sessionId;
let patientOpening;
let remainingSeconds = interviewDuration;
let timerInterval;
let toastTimeout;
let lastPatientAudio;
let currentAudio;
let currentAudioUrl;
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

function stopCurrentAudio() {
  if (!currentAudio) return;
  currentAudio.pause();
  currentAudio.removeAttribute("src");
  if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
  currentAudioUrl = undefined;
  currentAudio = undefined;
}

async function playPatientAudio(audioBlob) {
  stopCurrentAudio();
  currentAudioUrl = URL.createObjectURL(audioBlob);
  const audio = new Audio(currentAudioUrl);
  currentAudio = audio;
  setPatientStatus("Patient is speaking…", "speaking");
  replayButton.disabled = true;

  await new Promise((resolve) => {
    let finished = false;
    const finish = (status) => {
      if (finished) return;
      finished = true;
      if (currentAudio === audio) {
        currentAudio = undefined;
        if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
        currentAudioUrl = undefined;
      }
      if (phase === "interview") {
        setPatientStatus(status || "Your turn to ask", "");
        sendButton.disabled = false;
        replayButton.disabled = !lastPatientAudio;
      }
      resolve();
    };
    audio.addEventListener("ended", () => finish(), { once: true });
    audio.addEventListener("error", () => finish("Audio playback failed. Try replaying."), { once: true });
    audio.play().catch(() => {
      finish("Tap “Replay patient” to hear the response.");
      replayButton.disabled = false;
    });
  });
}

async function speakPatient(text) {
  setPatientStatus("Preparing patient response…", "thinking");
  replayButton.disabled = true;
  sendButton.disabled = true;
  try {
    const response = await fetch("/api/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Patient speech could not be generated.");
    }
    lastPatientAudio = await response.blob();
    if (phase === "interview") await playPatientAudio(lastPatientAudio);
  } catch (error) {
    setPatientStatus("Patient audio unavailable", "");
    sendButton.disabled = false;
    replayButton.disabled = !lastPatientAudio;
    showError(error.message);
  }
}

async function loadCaseFile() {
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
  lastPatientAudio = undefined;
  stopCurrentAudio();
  replayButton.disabled = true;

  try {
    const data = await requestJson("/api/sessions", {});
    sessionId = data.sessionId;
    patientOpening = data.patient.opening;
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

function beginInterview() {
  if (!sessionId || phase !== "file") return;
  phase = "interview";
  caseScreen.classList.add("hidden");
  diagnosisScreen.classList.add("hidden");
  encounterScreen.classList.remove("hidden");
  timerChip.classList.remove("hidden");
  document.querySelector("#encounter-title").textContent = "Your consultation";
  remainingSeconds = interviewDuration;
  updateTimer();
  timerInterval = setInterval(() => {
    remainingSeconds -= 1;
    updateTimer();
    if (remainingSeconds <= 0) {
      finishInterview(true);
    }
  }, 1000);
  speakPatient(patientOpening);
}

function finishInterview(timeExpired = false) {
  if (phase !== "interview") return;
  phase = "diagnosis";
  clearInterval(timerInterval);
  timerInterval = undefined;
  stopCurrentAudio();
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
  replayButton.disabled = true;
  setPatientStatus("Patient is thinking…", "thinking");
  try {
    const data = await requestJson("/api/chat", { sessionId, message });
    if (phase === "interview") await speakPatient(data.reply);
  } catch (error) {
    setPatientStatus("Ready when you are", "");
    sendButton.disabled = false;
    replayButton.disabled = !lastPatientAudio;
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
  const feedback = document.createElement("p");
  feedback.textContent = data.feedback;
  const expected = document.createElement("p");
  expected.className = "expected";
  expected.textContent = `Leading diagnosis: ${data.expectedDiagnosis}`;
  const resultItems = [thankYou, score, feedback, expected];
  if (data.keyFindings.length) {
    const heading = document.createElement("h3");
    heading.textContent = "History checklist";
    const findings = document.createElement("ul");
    for (const finding of data.keyFindings) {
      const item = document.createElement("li");
      item.textContent = `${finding}${data.coveredFindings.includes(finding) ? " · asked" : ""}`;
      findings.append(item);
    }
    resultItems.push(heading, findings);
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
replayButton.addEventListener("click", () => {
  if (lastPatientAudio && phase === "interview" && !requestPending) {
    playPatientAudio(lastPatientAudio);
  }
});
seePatientButton.addEventListener("click", beginInterview);
document.querySelector("#diagnose-finish").addEventListener("click", () => finishInterview());
diagnosisForm.addEventListener("submit", submitDiagnosis);
document.querySelector("#new-case").addEventListener("click", loadCaseFile);

loadCaseFile();
