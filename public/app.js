const chatLog = document.querySelector("#chat-log");
const chatForm = document.querySelector("#chat-form");
const chatInput = document.querySelector("#chat-input");
const sendButton = document.querySelector("#send-button");
const thinking = document.querySelector("#thinking");
const toast = document.querySelector("#toast");
const diagnosisForm = document.querySelector("#diagnosis-form");
const diagnosisInput = document.querySelector("#diagnosis-input");
const diagnosisButton = document.querySelector("#diagnosis-button");
const result = document.querySelector("#result");

let sessionId;
let toastTimeout;

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
  if (!response.ok) throw new Error(data.error || "The request could not be completed.");
  return data;
}

function addMessage(role, text) {
  const wrapper = document.createElement("article");
  wrapper.className = `message ${role}`;
  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = role === "patient" ? "JL" : "YOU";
  avatar.setAttribute("aria-hidden", "true");
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;
  wrapper.append(avatar, bubble);
  chatLog.append(wrapper);

  if (role === "patient") {
    const actions = document.createElement("div");
    actions.className = "message-actions";
    const speakButton = document.createElement("button");
    speakButton.className = "audio-button";
    speakButton.type = "button";
    speakButton.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6l-5 4H4ZM17 9a5 5 0 0 1 0 6M19 6a9 9 0 0 1 0 12" /></svg><span>Listen</span>';
    speakButton.addEventListener("click", () => speak(text, speakButton));
    actions.append(speakButton);
    chatLog.append(actions);
  }
  chatLog.scrollTop = chatLog.scrollHeight;
}

async function speak(text, button) {
  button.disabled = true;
  try {
    const response = await fetch("/api/speech", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Speech generation failed.");
    }
    const audio = new Audio(URL.createObjectURL(await response.blob()));
    audio.addEventListener("ended", () => URL.revokeObjectURL(audio.src), { once: true });
    await audio.play();
  } catch (error) {
    showError(error.message);
  } finally {
    button.disabled = false;
  }
}

async function startSession() {
  chatLog.replaceChildren();
  document.querySelector("#result").classList.add("hidden");
  diagnosisInput.value = "";
  document.querySelector("#notes").value = "";
  try {
    const data = await requestJson("/api/sessions", {});
    sessionId = data.sessionId;
    document.querySelector("#case-title").textContent = data.caseTitle;
    document.querySelector("#patient-name").textContent = data.patient.name;
    document.querySelector("#patient-age").textContent = `${data.patient.age} years old · Here to talk`;
    addMessage("patient", data.patient.opening);
  } catch (error) {
    showError(error.message);
  }
}

chatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = chatInput.value.trim();
  if (!message || !sessionId || sendButton.disabled) return;
  chatInput.value = "";
  chatInput.style.height = "auto";
  addMessage("student", message);
  sendButton.disabled = true;
  thinking.classList.remove("hidden");
  try {
    const data = await requestJson("/api/chat", { sessionId, message });
    addMessage("patient", data.reply);
  } catch (error) {
    showError(error.message);
  } finally {
    thinking.classList.add("hidden");
    sendButton.disabled = false;
    chatInput.focus();
  }
});

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
diagnosisForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!sessionId || diagnosisButton.disabled) return;
  diagnosisButton.disabled = true;
  try {
    const data = await requestJson("/api/diagnosis", {
      sessionId,
      diagnosis: diagnosisInput.value.trim(),
    });
    result.replaceChildren();
    const score = document.createElement("div");
    score.className = "result-score";
    score.textContent = `${data.score}/100`;
    const feedback = document.createElement("p");
    feedback.textContent = data.feedback;
    const expected = document.createElement("p");
    expected.className = "expected";
    expected.textContent = `Leading diagnosis: ${data.expectedDiagnosis}`;
    const heading = document.createElement("h3");
    heading.textContent = "History checklist";
    const findings = document.createElement("ul");
    for (const finding of data.keyFindings) {
      const item = document.createElement("li");
      item.textContent = `${finding}${data.coveredFindings.includes(finding) ? " · asked" : ""}`;
      findings.append(item);
    }
    result.append(score, feedback, expected, heading, findings);
    result.classList.remove("hidden");
  } catch (error) {
    showError(error.message);
  } finally {
    diagnosisButton.disabled = false;
  }
});

document.querySelector("#new-case").addEventListener("click", startSession);
startSession();
