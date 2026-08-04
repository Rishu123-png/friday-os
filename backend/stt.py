# FRIDAY OS — Speech-to-text. faster-whisper is a heavy optional dep:
# the server still boots without it and /v1/stt returns a clear error.
# Install: pip install faster-whisper
_model = None
_model_lock = None


def _get_model(name: str):
    global _model, _model_lock
    if _model is not None:
        return _model
    if _model_lock is None:
        import threading
        _model_lock = threading.Lock()
    with _model_lock:
        if _model is not None:
            return _model
        try:
            from faster_whisper import WhisperModel
        except ImportError:
            raise RuntimeError(
                "STT engine not installed on server — run: pip install faster-whisper "
                "(heavy; ~2GB with deps). Until then the app falls back to on-device STT.")
        _model = WhisperModel(name, device="cpu", compute_type="int8")
        return _model


def transcribe_file(path: str, model_name: str = "small") -> dict:
    """Transcribe an uploaded audio file (wav/mp3/m4a/ogg...). Returns
    { text, language, segments } or raises RuntimeError with a friendly msg."""
    model = _get_model(model_name)
    segments, info = model.transcribe(path, vad_filter=True,
                                      language=None, beam_size=5)
    parts = [s.text.strip() for s in segments]
    text = " ".join(parts).strip()
    return {"text": text, "language": getattr(info, "language", "unknown"),
            "segments": len(parts)}
