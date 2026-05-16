const els = {
  micBtn: document.getElementById("micBtn"),
  transcriptBox: document.getElementById("transcriptBox"),
  interimLine: document.getElementById("interimLine"),
  statusText: document.getElementById("statusText"),
  statusBadge: document.getElementById("statusBadge"),
  copyBtn: document.getElementById("copyBtn"),
  clearBtn: document.getElementById("clearBtn"),
  visualizer: document.getElementById("visualizer"),
};

let isRecording = false;
let transcript = "";
let speechRecognition = null;
let audioStream = null;
let audioContext = null;
let analyser = null;
let animFrame = null;

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const speechSupported = Boolean(SpeechRecognition);

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
  setTimeout(() => toast.classList.remove("toast--visible"), 2200);
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

async function startVisualizer() {
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
    /* visualizer optional */
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

function startRecognition() {
  if (!speechSupported) {
    showToast("Use Chrome or Edge for Urdu speech");
    return;
  }

  speechRecognition = new SpeechRecognition();
  speechRecognition.lang = "ur-PK";
  speechRecognition.continuous = true;
  speechRecognition.interimResults = true;
  speechRecognition.maxAlternatives = 1;

  speechRecognition.onresult = (event) => {
    let interim = "";
    let final = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = result[0].transcript;
      if (result.isFinal) final += text;
      else interim += text;
    }

    if (interim) setInterim(interim);
    if (final) {
      setInterim("");
      appendText(final);
    }
  };

  speechRecognition.onerror = (event) => {
    if (event.error !== "aborted") {
      setStatus(`Error: ${event.error}`);
      if (event.error === "not-allowed") {
        showToast("Microphone permission required");
      }
    }
  };

  speechRecognition.onend = () => {
    if (isRecording) {
      try {
        speechRecognition.start();
      } catch {
        /* already started */
      }
    }
  };

  speechRecognition.start();
  isRecording = true;
  els.micBtn.classList.add("mic-btn--recording");
  els.micBtn.setAttribute("aria-pressed", "true");
  els.micBtn.setAttribute("aria-label", "Stop recording");
  els.micBtn.querySelector(".mic-icon").hidden = true;
  els.micBtn.querySelector(".stop-icon").hidden = false;
  setBadge("recording");
  setStatus("Listening — speak in Urdu", true);
  startVisualizer();
}

function stopRecognition() {
  if (speechRecognition) {
    speechRecognition.onend = null;
    speechRecognition.stop();
    speechRecognition = null;
  }
  setInterim("");
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
    showToast("Use Chrome or Edge for Urdu speech");
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
  setInterim("");
  renderTranscript();
  setStatus("Transcript cleared");
});

function init() {
  renderTranscript();
  if (speechSupported) {
    setBadge("ready");
    setStatus("Ready — press the button to record");
  } else {
    setBadge("unsupported");
    setStatus("Use Chrome or Edge — speech API not available");
    els.micBtn.disabled = true;
  }
}

init();

