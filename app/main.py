import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import CHUNK_SECONDS, SAMPLE_RATE
from app.transcriber import bytes_to_pcm16, get_model, transcribe_pcm

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


@asynccontextmanager
async def lifespan(_: FastAPI):
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, get_model)
    logger.info("Whisper model ready for Urdu")
    yield


app = FastAPI(title="Urdu Voice to Text", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/css", StaticFiles(directory=STATIC_DIR / "css"), name="css")
app.mount("/js", StaticFiles(directory=STATIC_DIR / "js"), name="js")


@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/health")
async def health():
    return {"status": "ok", "modes": ["browser", "whisper"]}


@app.websocket("/ws/transcribe")
async def transcribe_ws(websocket: WebSocket):
    await websocket.accept()
    pcm_buffer: list[np.ndarray] = []
    total_samples = 0
    chunk_target = int(SAMPLE_RATE * CHUNK_SECONDS)

    try:
        await websocket.send_json({"type": "ready", "language": "ur"})

        while True:
            message = await websocket.receive()

            if message.get("type") == "websocket.disconnect":
                break

            if "bytes" in message and message["bytes"]:
                pcm = bytes_to_pcm16(message["bytes"])
                if pcm.size == 0:
                    continue

                pcm_buffer.append(pcm)
                total_samples += pcm.size

                if total_samples < chunk_target:
                    await websocket.send_json({"type": "listening"})
                    continue

                combined = np.concatenate(pcm_buffer)
                pcm_buffer.clear()
                total_samples = 0

                await websocket.send_json({"type": "processing"})
                loop = asyncio.get_event_loop()
                text = await loop.run_in_executor(None, transcribe_pcm, combined)
                if text:
                    await websocket.send_json({"type": "transcript", "text": text, "final": True})
                else:
                    await websocket.send_json({"type": "listening", "hint": "no_speech"})

            elif "text" in message and message["text"]:
                payload = message["text"]
                if payload == "flush" and pcm_buffer:
                    combined = np.concatenate(pcm_buffer)
                    pcm_buffer.clear()
                    total_samples = 0
                    loop = asyncio.get_event_loop()
                    text = await loop.run_in_executor(None, transcribe_pcm, combined)
                    if text:
                        await websocket.send_json({"type": "transcript", "text": text, "final": True})
                elif payload == "stop":
                    break

    except WebSocketDisconnect:
        logger.info("Client disconnected")
    except Exception as exc:
        logger.exception("WebSocket error: %s", exc)
        try:
            await websocket.send_json({"type": "error", "message": "Server error — try again"})
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
