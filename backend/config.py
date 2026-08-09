# FRIDAY OS — Backend server
# Configuration via environment variables (see .env.example)
import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).parent / ".env")
except Exception:
    pass  # python-dotenv is optional; env vars can be set directly


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


class Settings:
    # The Groq API key lives HERE, never in the app. Optional: leave blank
    # and the server returns a friendly error instead of proxying.
    GROQ_API_KEY: str = _env("GROQ_API_KEY")

    # Shared secret between app and server. If empty, auth is disabled
    # (fine for localhost, NOT for the public internet).
    FRIDAY_TOKEN: str = _env("FRIDAY_TOKEN")

    # Default LLM model served at /v1/chat
    GROQ_MODEL: str = _env("GROQ_MODEL", "llama-3.3-70b-versatile")

    # Optional Blackbox fallback. Disabled unless ALL of these are supplied.
    # BLACKBOX_FREE_MODELS is an operator attestation; never list a model here
    # unless the account dashboard confirms it is free for that account.
    BLACKBOX_ENABLED: bool = _env("BLACKBOX_ENABLED", "false").lower() in ("1", "true", "yes", "on")
    BLACKBOX_API_KEY: str = _env("BLACKBOX_API_KEY")
    BLACKBOX_MODEL: str = _env("BLACKBOX_MODEL", "blackboxai/minimax/minimax-m2.5")
    BLACKBOX_FREE_MODELS: str = _env("BLACKBOX_FREE_MODELS")

    # Vision (multimodal) model used by /v1/vision for image descriptions
    GROQ_VISION_MODEL: str = _env("GROQ_VISION_MODEL", "meta-llama/llama-4-scout-17b-16e-instruct")

    # CORS: in production set this to your app's origin, or "*" for the APK
    # (Capacitor WebView has no Origin header, so "*" is the practical choice).
    CORS_ORIGINS: str = _env("CORS_ORIGINS", "*")

    # Where the SQLite memory file lives
    DB_PATH: str = _env("DB_PATH", str(Path(__file__).parent / "friday.db"))

    # Max audio upload size for /v1/stt (bytes)
    MAX_AUDIO_BYTES: int = int(_env("MAX_AUDIO_BYTES", "25_000_000"))

    # TTS voice (edge-tts short name). "hi-IN" for Hindi.
    TTS_VOICE: str = _env("TTS_VOICE", "en-IN-NeerjaNeural")
    # Whisper size for STT: tiny | base | small | medium
    STT_MODEL: str = _env("STT_MODEL", "small")
    # Embedding model (sentence-transformers id), optional
    EMBED_MODEL: str = _env("EMBED_MODEL", "sentence-transformers/all-MiniLM-L6-v2")

    # ---- v1.1: Telegram bridge (talk to FRIDAY from Telegram) ----
    # Bot token from @BotFather. Leave empty to disable the bridge.
    TELEGRAM_BOT_TOKEN: str = _env("TELEGRAM_BOT_TOKEN")
    # Comma-separated numeric Telegram user IDs allowed to talk to FRIDAY
    # (find yours with @userinfobot). Empty = allow everyone (risky!).
    TELEGRAM_ALLOWED_IDS: str = _env("TELEGRAM_ALLOWED_IDS")

    # ---- v1.1: Smart home (MQTT, optional) ----
    MQTT_HOST: str = _env("MQTT_HOST")
    MQTT_PORT: int = int(_env("MQTT_PORT", "1883"))
    MQTT_USER: str = _env("MQTT_USER")
    MQTT_PASS: str = _env("MQTT_PASS")
    MQTT_PREFIX: str = _env("MQTT_PREFIX", "friday")

    VERSION: str = "1.2.0"


settings = Settings()
