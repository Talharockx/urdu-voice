import os

WHISPER_MODEL = os.getenv("WHISPER_MODEL", "medium")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
LANGUAGE = "ur"
SAMPLE_RATE = 16000
CHUNK_SECONDS = float(os.getenv("CHUNK_SECONDS", "1.8"))
MIN_AUDIO_BYTES = int(os.getenv("MIN_AUDIO_BYTES", "3200"))
