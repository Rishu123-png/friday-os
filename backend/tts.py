# FRIDAY OS — Text-to-speech.
# Primary: edge-tts (free Microsoft neural voices, multilingual incl hi-IN,
#          pip-installable, no API key, needs internet).
# Optional offline: Kokoro (pip install kokoro) or Piper.
import io

from config import settings


async def synthesize(text: str, voice: str | None = None) -> bytes:
    """Returns MP3 bytes. Raises RuntimeError with a friendly message on failure."""
    voice = voice or settings.TTS_VOICE
    try:
        import edge_tts
    except ImportError:
        raise RuntimeError("TTS engine not installed — run: pip install edge-tts")

    communicate = edge_tts.Communicate(text[:2000], voice=voice, rate="+0%")
    buf = io.BytesIO()
    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            buf.write(chunk["data"])
    data = buf.getvalue()
    if not data:
        raise RuntimeError("TTS produced no audio (voice may be invalid)")
    return data
