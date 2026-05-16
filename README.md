# اردو آواز سے متن | Real-Time Urdu Voice to Text

حقیقی وقت میں اردو تقریر کو درست اردو متن میں تبدیل کرنے والا سسٹم — Whisper ماڈل کے ساتھ، موبائل اور ڈیسک ٹاپ دونوں پر۔

## Features

- **High-quality Urdu** — OpenAI Whisper (`medium` model) tuned for Urdu (`ur`)
- **Real-time streaming** — WebSocket audio chunks, live transcript updates
- **Mobile responsive** — RTL layout, Noto Nastaliq Urdu, safe-area insets
- **Browser fallback** — Optional Web Speech API mode (`ur-PK`) without server

## Requirements

- Python 3.10+
- [FFmpeg](https://ffmpeg.org/download.html) (for decoding browser audio)
- Microphone + HTTPS or `localhost` (browser mic policy)

## Quick start (Windows)

```powershell
cd "Real Time Voice Urdu Text System"
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Or double-click `run.bat` after installing dependencies.

Open **http://localhost:8000** in Chrome or Edge (recommended).

> First run downloads the Whisper model (~1.5 GB for `medium`). Use `WHISPER_MODEL=small` for faster setup.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WHISPER_MODEL` | `medium` | `tiny`, `base`, `small`, `medium`, `large-v3` |
| `WHISPER_DEVICE` | `cpu` | `cpu` or `cuda` (GPU) |
| `WHISPER_COMPUTE_TYPE` | `int8` | `int8`, `float16`, `float32` |
| `CHUNK_SECONDS` | `2.5` | Audio buffer before each transcription |

Example (GPU, best quality):

```powershell
$env:WHISPER_MODEL="large-v3"
$env:WHISPER_DEVICE="cuda"
$env:WHISPER_COMPUTE_TYPE="float16"
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## Usage

1. Allow microphone access when prompted.
2. Press the microphone button and speak in Urdu.
3. Text appears in the transcript panel (RTL, Nastaliq font).
4. Use **کاپی** to copy or **صاف** to clear.
5. Toggle **براؤزر موڈ** only if the server is unavailable (lower accuracy).

## Architecture

```
Browser (MediaRecorder) → WebSocket → FastAPI → faster-whisper (ur)
                                      ↓
                              Urdu transcript JSON
```

## Tips for best Urdu accuracy

- Speak clearly at a normal pace in standard Urdu.
- Use a quiet environment and a decent microphone.
- Prefer Whisper mode over browser mode.
- For production, use `large-v3` on GPU and HTTPS.

## License

MIT
