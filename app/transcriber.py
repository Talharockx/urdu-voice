import logging
import threading
from typing import Optional

import numpy as np
from faster_whisper import WhisperModel

from app.config import (
    LANGUAGE,
    SAMPLE_RATE,
    WHISPER_COMPUTE_TYPE,
    WHISPER_DEVICE,
    WHISPER_MODEL,
)

logger = logging.getLogger(__name__)

_model: Optional[WhisperModel] = None
_model_lock = threading.Lock()


def get_model() -> WhisperModel:
    global _model
    with _model_lock:
        if _model is None:
            logger.info(
                "Loading Whisper model=%s device=%s compute=%s",
                WHISPER_MODEL,
                WHISPER_DEVICE,
                WHISPER_COMPUTE_TYPE,
            )
            _model = WhisperModel(
                WHISPER_MODEL,
                device=WHISPER_DEVICE,
                compute_type=WHISPER_COMPUTE_TYPE,
            )
        return _model


def bytes_to_pcm16(audio_bytes: bytes) -> np.ndarray:
    if len(audio_bytes) < 2:
        return np.array([], dtype=np.float32)
    samples = np.frombuffer(audio_bytes, dtype=np.int16)
    return samples.astype(np.float32) / 32768.0


def transcribe_pcm(audio: np.ndarray) -> str:
    if audio.size < SAMPLE_RATE * 0.4:
        return ""

    model = get_model()
    segments, _info = model.transcribe(
        audio,
        language=LANGUAGE,
        task="transcribe",
        beam_size=5,
        best_of=5,
        temperature=0.0,
        vad_filter=False,
        condition_on_previous_text=True,
        initial_prompt="یہ اردو تقریر ہے۔",
    )

    parts = [seg.text.strip() for seg in segments if seg.text.strip()]
    return " ".join(parts).strip()
