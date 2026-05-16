const els = {
  micBtn: document.getElementById("micBtn"),
  transcriptBox: document.getElementById("transcriptBox"),
  interimLine: document.getElementById("interimLine"),
  statusText: document.getElementById("statusText"),
  statusBadge: document.getElementById("statusBadge"),
  copyBtn: document.getElementById("copyBtn"),
  clearBtn: document.getElementById("clearBtn"),
  visualizer: document.getElementById("visualizer"),
  mobileHint: document.getElementById("mobileHint"),
};

let isRecording = false;
let transcript = "";
let speechRecognition = null;
let audioStream = null;
let audioContext = null;
let analyser = null;
let animFrame = null;
let pendingInterim = "";
let langIndex = 0;
let restartTimer = null;

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const speechSupported = Boolean(SpeechRecognition);

const isIOS =
  /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isMobile =
  isIOS || /Android|webOS|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent);

const URDU_LANGS = ["ur-PK", "ur-IN", "ur", "hi-IN"];

function setStatus(text, active = false) {
  els.statusText.textContent = text;
  els.statusText.classList.toggle("status-text--active", active);
}

function setBadge(state) {
  const map = {
    ready: ["Ready", "badge--online"],
    unsupported: ["Unsupported", "badge--offline"],
    recording: ["Recording", "badge--recording"],
  };
  const [label, cls] = map[state] || map.ready;
  els.statusBadge.textContent = label;
  els.statusBadge.className = `badge ${cls}`;
}

function showToast(message) {
  let toast = document.querySelector(".toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("toast--visible");
  setTimeout(() => toast.classList.remove("toast--visible"), 2800);
}

function renderTranscript() {
  if (!transcript.trim()) {
    els.transcriptBox.innerHTML =
      '<p class="placeholder">Press the microphone and start speaking in Urdu…</p>';
    els.copyBtn.disabled = true;
    els.clearBtn.disabled = true;
    return;
  }

  const segments = transcript.trim().split(/\s+/);
  els.transcriptBox.innerHTML = segments
    .map((word, i) => `<span class="segment" data-i="${i}">${escapeHtml(word)}</span>`)
    .join(" ");

  els.copyBtn.disabled = false;
  els.clearBtn.disabled = false;
  els.transcriptBox.scrollTop = els.transcriptBox.scrollHeight;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function appendText(text) {
  const cleaned = text.trim();
  if (!cleaned) return;
  transcript = transcript ? `${transcript} ${cleaned}` : cleaned;
  renderTranscript();
}

function setInterim(text) {
  if (!text) {
    els.interimLine.hidden = true;
    els.interimLine.textContent = "";
    return;
  }
  els.interimLine.hidden = false;
  els.interimLine.textContent = text;
}

function commitPendingInterim() {
  if (pendingInterim.trim()) {
    appendText(pendingInterim);
    pendingInterim = "";
    setInterim("");
  }
}

async function startVisualizer() {
  if (isMobile) return;

  try {
    audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(audioStream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 64;
    source.connect(analyser);

    const canvas = els.visualizer;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const data = new Uint8Array(analyser.frequencyBinCount);
    const draw = () => {
      if (!isRecording) return;
      animFrame = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(data);
      const w = canvas.getBoundingClientRect().width;
      const h = canvas.getBoundingClientRect().height;
      ctx.clearRect(0, 0, w, h);
      const barW = w / data.length;
      for (let i = 0; i < data.length; i++) {
        const barH = (data[i] / 255) * h * 0.9;
        const gradient = ctx.createLinearGradient(0, h, 0, h - barH);
        gradient.addColorStop(0, "#14b8a6");
        gradient.addColorStop(1, "#5eead4");
        ctx.fillStyle = gradient;
        ctx.fillRect(i * barW, h - barH, barW - 2, barH);
      }
    };
    draw();
  } catch {
    /* optional */
  }
}

function cleanupAudio() {
  if (animFrame) cancelAnimationFrame(animFrame);
  animFrame = null;
  analyser = null;
  audioContext?.close().catch(() => {});
  audioContext = null;
  audioStream?.getTracks().forEach((t) => t.stop());
  audioStream = null;
  const ctx = els.visualizer.getContext("2d");
  ctx.clearRect(0, 0, els.visualizer.width, els.visualizer.height);
}

function clearRestartTimer() {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
}

function scheduleRestart() {
  clearRestartTimer();
  if (!isRecording) return;
  restartTimer = setTimeout(() => {
    if (!isRecording || !speechRecognition) return;
    try {
      speechRecognition.start();
    } catch {
      /* busy */
    }
  }, isIOS ? 400 : 200);
}

function createRecognition() {
  const recognition = new SpeechRecognition();
  recognition.lang = URDU_LANGS[langIndex];
  recognition.continuous = !isMobile;
  recognition.interimResults = true;
  recognition.maxAlternatives = 3;
  return recognition;
}

function bindRecognitionHandlers() {
  speechRecognition.onresult = (event) => {
    let interim = "";
    let final = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = (result[0] && result[0].transcript) || "";
      if (!text) continue;

      if (result.isFinal) {
        final += text;
      } else {
        interim += text;
      }
    }

    if (interim) {
      pendingInterim = interim;
      setInterim(interim);
    }

    if (final) {
      pendingInterim = "";
      setInterim("");
      appendText(final);
    }
  };

  speechRecognition.onerror = (event) => {
    if (event.error === "aborted") return;

    if (event.error === "not-allowed") {
      setStatus("Allow microphone in browser settings");
      showToast("Microphone permission required");
      stopRecognition();
      return;
    }

    if (event.error === "language-not-supported" && langIndex < URDU_LANGS.length - 1) {
      langIndex += 1;
      showToast(`Trying language: ${URDU_LANGS[langIndex]}`);
      restartRecognition();
      return;
    }

    if (event.error === "no-speech" && isRecording) {
      scheduleRestart();
      return;
    }

    if (event.error === "network") {
      setStatus("Internet required for speech on mobile");
      showToast("Turn on Wi‑Fi or mobile data");
      return;
    }

    setStatus(`Error: ${event.error}`);
  };

  speechRecognition.onend = () => {
    commitPendingInterim();
    if (isRecording) scheduleRestart();
  };

  speechRecognition.onspeechstart = () => {
    setStatus("Listening — speak in Urdu", true);
  };
}

function restartRecognition() {
  if (!isRecording) return;
  try {
    speechRecognition?.stop();
  } catch {
    /* ignore */
  }
  speechRecognition = createRecognition();
  bindRecognitionHandlers();
  try {
    speechRecognition.start();
  } catch (err) {
    console.error(err);
    showToast("Could not restart — tap mic again");
  }
}

function startRecognition() {
  if (!speechSupported) {
    showToast("Use Chrome on Android or desktop Chrome/Edge");
    return;
  }

  langIndex = 0;
  pendingInterim = "";
  speechRecognition = createRecognition();
  bindRecognitionHandlers();

  try {
    speechRecognition.start();
  } catch (err) {
    console.error(err);
    showToast("Could not start — tap mic again");
    return;
  }

  isRecording = true;
  els.micBtn.classList.add("mic-btn--recording");
  els.micBtn.setAttribute("aria-pressed", "true");
  els.micBtn.setAttribute("aria-label", "Stop recording");
  els.micBtn.querySelector(".mic-icon").hidden = true;
  els.micBtn.querySelector(".stop-icon").hidden = false;
  setBadge("recording");
  setStatus(
    isMobile ? "Listening — speak clearly, pause between phrases" : "Listening — speak in Urdu",
    true
  );
  startVisualizer();
}

function stopRecognition() {
  clearRestartTimer();
  commitPendingInterim();

  if (speechRecognition) {
    speechRecognition.onend = null;
    try {
      speechRecognition.stop();
    } catch {
      /* ignore */
    }
    speechRecognition = null;
  }

  isRecording = false;
  cleanupAudio();
  els.micBtn.classList.remove("mic-btn--recording");
  els.micBtn.setAttribute("aria-pressed", "false");
  els.micBtn.setAttribute("aria-label", "Start recording");
  els.micBtn.querySelector(".mic-icon").hidden = false;
  els.micBtn.querySelector(".stop-icon").hidden = true;
  setBadge(speechSupported ? "ready" : "unsupported");
  setStatus("Stopped — tap mic to record again");
}

function toggleRecording() {
  if (!speechSupported) {
    showToast("Use Chrome on Android or desktop Chrome/Edge");
    return;
  }
  if (isRecording) stopRecognition();
  else startRecognition();
}

els.micBtn.addEventListener("click", toggleRecording);

els.copyBtn.addEventListener("click", async () => {
  if (!transcript.trim()) return;
  try {
    await navigator.clipboard.writeText(transcript);
    showToast("Copied to clipboard");
  } catch {
    showToast("Could not copy");
  }
});

els.clearBtn.addEventListener("click", () => {
  transcript = "";
  pendingInterim = "";
  setInterim("");
  renderTranscript();
  setStatus("Transcript cleared");
});

function init() {
  renderTranscript();

  if (els.mobileHint) {
    if (isIOS) {
      els.mobileHint.textContent =
        "iPhone: Use Safari or Chrome. Speak in short phrases. Urdu support may be limited on iOS.";
      els.mobileHint.hidden = false;
    } else if (isMobile) {
      els.mobileHint.textContent =
        "Mobile: Use Chrome, allow mic, stay online. Speak clearly in short Urdu phrases.";
      els.mobileHint.hidden = false;
    }
  }

  if (speechSupported) {
    setBadge("ready");
    setStatus(
      isMobile ? "Ready — tap mic, allow access, speak in Urdu" : "Ready — press the button to record"
    );
  } else {
    setBadge("unsupported");
    setStatus("Speech not supported — try Chrome on Android or desktop");
    els.micBtn.disabled = true;
  }
}

init();
