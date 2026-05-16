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
  iosWarning: document.getElementById("iosWarning"),
  copyLinkBtn: document.getElementById("copyLinkBtn"),
};

let isRecording = false;
let transcript = "";
let speechRecognition = null;
let ws = null;
let audioStream = null;
let audioContext = null;
let analyser = null;
let pcmProcessor = null;
let silentGain = null;
let animFrame = null;
let pendingInterim = "";
let langIndex = 0;
let restartTimer = null;

const TARGET_SAMPLE_RATE = 16000;
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const URDU_LANGS = ["ur-PK", "ur-IN", "ur", "hi-IN"];

const isIOS =
  /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isIOSChrome = isIOS && /CriOS/i.test(navigator.userAgent);
const isIOSSafari =
  isIOS && !isIOSChrome && !/FxiOS|EdgiOS|OPiOS/i.test(navigator.userAgent);
const isMobile =
  isIOS || /Android|webOS|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent);

function getApiBase() {
  const meta = document.querySelector('meta[name="speech-api"]')?.content?.trim();
  if (meta) return meta.replace(/\/$/, "");
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    return `${location.protocol}//${location.host}`;
  }
  return "";
}

const API_BASE = getApiBase();

function getWsUrl() {
  if (API_BASE) {
    const wsBase = API_BASE.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
    return `${wsBase}/ws/transcribe`;
  }
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws/transcribe`;
}

const useServerOnIOS = isIOS && Boolean(API_BASE);
const useBrowserMode = !isIOS && Boolean(SpeechRecognition);

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
    toast = document.createElement("d" + "iv");
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("toast--visible");
  setTimeout(() => toast.classList.remove("toast--visible"), 2800);
}

function showIosWarning(html) {
  if (!els.iosWarning) return;
  els.iosWarning.innerHTML = html;
  els.iosWarning.hidden = false;
}

function hideIosWarning() {
  if (els.iosWarning) els.iosWarning.hidden = true;
}

function showChromeIosHelp() {
  setBadge("unsupported");
  setStatus("Use Safari, or enable cloud mode on this site");
  showToast("Chrome on iPhone cannot use speech");
  showIosWarning(`
    <p><strong>Chrome on iPhone cannot use voice typing.</strong></p>
    <p>Apple blocks speech in Chrome. Options:</p>
    <ol>
      <li>Open in <strong>Safari</strong> (Share → Open in Safari), or</li>
      <li>Use this site on <strong>Android / computer</strong></li>
    </ol>
    <button type="button" id="copyLinkBtn" class="btn btn--primary">Copy site link</button>
  `);
  document.getElementById("copyLinkBtn")?.addEventListener("click", copySiteLink, { once: true });
}

function showIosNeedsApi() {
  setBadge("unsupported");
  setStatus("iPhone needs cloud API — see GitHub setup");
  showIosWarning(`
    <p><strong>iPhone cannot transcribe Urdu in the browser alone.</strong></p>
    <p>Safari and Chrome on iPhone do not support Urdu speech. This site must use <strong>cloud mode</strong> (Whisper API on Render).</p>
    <p>Site owner: deploy <code>render.yaml</code> on Render, then set the API URL in <code>index.html</code>.</p>
    <p>Meanwhile use a <strong>computer</strong> or <strong>Android phone</strong> with Chrome.</p>
  `);
}

function showIosSafariLimit() {
  setBadge("unsupported");
  setStatus("Urdu speech not available in iPhone browser");
  showToast("Use cloud API or Android/desktop");
  showIosWarning(`
    <p><strong>Urdu voice typing is not supported in iPhone Safari.</strong></p>
    <p>Apple's browser cannot run Urdu speech recognition. Please use:</p>
    <ul>
      <li><strong>Android</strong> with Chrome, or</li>
      <li>A <strong>computer</strong> with Chrome/Edge</li>
    </ul>
  `);
}

async function copySiteLink() {
  try {
    await navigator.clipboard.writeText(location.href);
    showToast("Link copied");
  } catch {
    showToast(location.href);
  }
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

function cleanupAudio() {
  if (animFrame) cancelAnimationFrame(animFrame);
  animFrame = null;
  analyser = null;
  if (pcmProcessor) {
    pcmProcessor.onaudioprocess = null;
    pcmProcessor.disconnect();
    pcmProcessor = null;
  }
  if (silentGain) {
    silentGain.disconnect();
    silentGain = null;
  }
  audioContext?.close().catch(() => {});
  audioContext = null;
  audioStream?.getTracks().forEach((t) => t.stop());
  audioStream = null;
  const ctx = els.visualizer.getContext("2d");
  ctx.clearRect(0, 0, els.visualizer.width, els.visualizer.height);
}

function resetMicUI() {
  els.micBtn.classList.remove("mic-btn--recording");
  els.micBtn.setAttribute("aria-pressed", "false");
  els.micBtn.setAttribute("aria-label", "Start recording");
  els.micBtn.querySelector(".mic-icon").hidden = false;
  els.micBtn.querySelector(".stop-icon").hidden = true;
}

function downsampleTo16k(float32Array, inputRate) {
  if (inputRate === TARGET_SAMPLE_RATE) return float32Array;
  const ratio = inputRate / TARGET_SAMPLE_RATE;
  const outLen = Math.floor(float32Array.length / ratio);
  const result = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) result[i] = float32Array[Math.floor(i * ratio)];
  return result;
}

function float32ToInt16(float32Array) {
  const int16 = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}

function connectWebSocket() {
  return new Promise((resolve, reject) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      resolve(ws);
      return;
    }
    ws = new WebSocket(getWsUrl());
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      setBadge("online");
      resolve(ws);
    };
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "transcript" && data.text) {
          setInterim("");
          appendText(data.text);
          setStatus("Listening — speak in Urdu", true);
        } else if (data.type === "listening") {
          setStatus("Listening…", true);
        } else if (data.type === "error") {
          setStatus(data.message || "Error");
          showToast(data.message || "Error");
        }
      } catch {
        /* ignore */
      }
    };
    ws.onerror = () => {
      setBadge("offline");
      reject(new Error("WebSocket failed"));
    };
    ws.onclose = () => setBadge("ready");
  });
}

async function startServerRecording() {
  await connectWebSocket();
  audioStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
  });

  audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(audioStream);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 64;
  source.connect(analyser);

  pcmProcessor = audioContext.createScriptProcessor(4096, 1, 1);
  silentGain = audioContext.createGain();
  silentGain.gain.value = 0;
  source.connect(pcmProcessor);
  pcmProcessor.connect(silentGain);
  silentGain.connect(audioContext.destination);

  pcmProcessor.onaudioprocess = (event) => {
    if (!isRecording || !ws || ws.readyState !== WebSocket.OPEN) return;
    const input = event.inputBuffer.getChannelData(0);
    const resampled = downsampleTo16k(input, audioContext.sampleRate);
    ws.send(float32ToInt16(resampled).buffer);
  };

  isRecording = true;
  els.micBtn.classList.add("mic-btn--recording");
  els.micBtn.setAttribute("aria-pressed", "true");
  els.micBtn.querySelector(".mic-icon").hidden = true;
  els.micBtn.querySelector(".stop-icon").hidden = false;
  setBadge("recording");
  setStatus("Cloud mode — speak in Urdu", true);
  hideIosWarning();
}

function stopServerRecording() {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send("flush");
    setTimeout(() => ws.send("stop"), 300);
  }
  cleanupAudio();
  isRecording = false;
  resetMicUI();
  setBadge("ready");
  setStatus("Stopped — tap mic to record again");
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
    try {
      speechRecognition?.start();
    } catch {
      /* busy */
    }
  }, 400);
}

function createRecognition() {
  const r = new SpeechRecognition();
  r.lang = URDU_LANGS[langIndex];
  r.continuous = false;
  r.interimResults = true;
  r.maxAlternatives = 3;
  return r;
}

function bindBrowserHandlers() {
  speechRecognition.onresult = (event) => {
    let interim = "";
    let final = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      const text = (result[0] && result[0].transcript) || "";
      if (!text) continue;
      if (result.isFinal) final += text;
      else interim += text;
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
      setStatus("Allow microphone in Settings");
      showToast("Microphone permission required");
      stopBrowserRecording();
      return;
    }
    if (event.error === "language-not-supported" && langIndex < URDU_LANGS.length - 1) {
      langIndex += 1;
      restartBrowserRecognition();
      return;
    }
    if (event.error === "no-speech" && isRecording) {
      scheduleRestart();
      return;
    }
    if (event.error === "service-not-allowed") {
      stopBrowserRecording();
      if (isIOSSafari) showIosSafariLimit();
      else if (isIOSChrome) showChromeIosHelp();
      else showToast("Speech service not allowed");
      return;
    }
    if (event.error === "network") {
      showToast("Turn on internet connection");
      return;
    }
    setStatus(`Error: ${event.error}`);
  };

  speechRecognition.onend = () => {
    commitPendingInterim();
    if (isRecording) scheduleRestart();
  };
}

function restartBrowserRecognition() {
  try {
    speechRecognition?.stop();
  } catch {
    /* ignore */
  }
  speechRecognition = createRecognition();
  bindBrowserHandlers();
  speechRecognition.start();
}

function startBrowserRecording() {
  langIndex = 0;
  pendingInterim = "";
  speechRecognition = createRecognition();
  bindBrowserHandlers();
  speechRecognition.start();
  isRecording = true;
  els.micBtn.classList.add("mic-btn--recording");
  els.micBtn.setAttribute("aria-pressed", "true");
  els.micBtn.querySelector(".mic-icon").hidden = true;
  els.micBtn.querySelector(".stop-icon").hidden = false;
  setBadge("recording");
  setStatus("Listening — speak in Urdu", true);
  hideIosWarning();
}

function stopBrowserRecording() {
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
  resetMicUI();
  setBadge("ready");
  setStatus("Stopped — tap mic to record again");
}

async function toggleRecording() {
  if (isIOSChrome) {
    showChromeIosHelp();
    return;
  }

  if (isRecording) {
    if (useServerOnIOS) stopServerRecording();
    else stopBrowserRecording();
    return;
  }

  try {
    if (useServerOnIOS) await startServerRecording();
    else if (useBrowserMode) startBrowserRecording();
    else if (isIOS) showIosNeedsApi();
    else showToast("Speech not supported in this browser");
  } catch (err) {
    console.error(err);
    if (err.name === "NotAllowedError") {
      setStatus("Allow microphone access");
      showToast("Microphone permission required");
    } else if (useServerOnIOS) {
      setStatus("Cannot reach cloud API");
      showToast("Check speech-api URL in site settings");
    } else {
      setStatus("Could not start recording");
    }
    cleanupAudio();
    resetMicUI();
  }
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

  if (isIOSChrome) {
    showChromeIosHelp();
    els.micBtn.disabled = true;
    return;
  }

  if (useServerOnIOS) {
    hideIosWarning();
    setBadge("ready");
    setStatus("iPhone cloud mode — tap mic, speak Urdu");
    if (els.mobileHint) {
      els.mobileHint.textContent = "iPhone uses cloud transcription (Whisper). First tap may take ~30s while server starts.";
      els.mobileHint.hidden = false;
    }
    connectWebSocket().catch(() => setStatus("Connecting to cloud API…"));
    return;
  }

  if (isIOS && !API_BASE) {
    showIosNeedsApi();
    els.micBtn.disabled = true;
    return;
  }

  if (useBrowserMode) {
    setBadge("ready");
    setStatus(isMobile ? "Ready — tap mic and speak Urdu" : "Ready — press mic to record");
    if (els.mobileHint && isMobile) {
      els.mobileHint.textContent = "Use Chrome, allow mic, stay online.";
      els.mobileHint.hidden = false;
    }
    return;
  }

  setBadge("unsupported");
  setStatus("Use Chrome on Android or desktop");
  els.micBtn.disabled = true;
}

init();
