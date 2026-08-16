# FRIDAY OS — Backend server
# Configuration via host-managed environment variables (or backend/.env for local use).
import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    # Deliberately load only backend/.env. The repository root is never a secret store.
    load_dotenv(Path(__file__).parent / ".env")
except Exception:
    pass  # python-dotenv is optional; environment variables can be set directly


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


def _bool(name: str, default: bool = False) -> bool:
    raw = _env(name, "true" if default else "false")
    return raw.strip().lower() in ("1", "true", "yes", "on")


class Settings:
    # Provider credentials are backend-only. Never put these in the APK/web bundle.
    GROQ_API_KEY: str = _env("GROQ_API_KEY")
    GROQ_MODEL: str = _env("GROQ_MODEL", "llama-3.3-70b-versatile")
    GROQ_VISION_MODEL: str = _env(
        "GROQ_VISION_MODEL", "meta-llama/llama-4-scout-17b-16e-instruct"
    )

    BLACKBOX_ENABLED: bool = _bool("BLACKBOX_ENABLED")
    BLACKBOX_API_KEY: str = _env("BLACKBOX_API_KEY")
    BLACKBOX_MODEL: str = _env(
        "BLACKBOX_MODEL", "blackboxai/minimax/minimax-m2.5"
    )
    # Operator attestation: list only models the account dashboard confirms are free.
    BLACKBOX_FREE_MODELS: str = _env("BLACKBOX_FREE_MODELS")

    # Shared app↔server bearer secret. Authentication is fail-closed by default.
    FRIDAY_TOKEN: str = _env("FRIDAY_TOKEN")
    FRIDAY_ALLOW_INSECURE_LOCAL: bool = _bool("FRIDAY_ALLOW_INSECURE_LOCAL")
    ALLOW_USER_HEADER: bool = _bool("ALLOW_USER_HEADER")

    # Capacitor normally uses http://localhost. Add any browser/operator origins explicitly.
    CORS_ORIGINS: str = _env(
        "CORS_ORIGINS", "http://localhost,capacitor://localhost"
    )

    # Persistent state. Action queue is separate so it can be backed up/cleared independently.
    DB_PATH: str = _env("DB_PATH", str(Path(__file__).parent / "friday.db"))
    ACTION_DB_PATH: str = _env(
        "ACTION_DB_PATH", str(Path(__file__).parent / "action_queue.db")
    )
    ACTION_CLAIM_LEASE_SECONDS: int = int(_env("ACTION_CLAIM_LEASE_SECONDS", "90"))

    MAX_AUDIO_BYTES: int = int(_env("MAX_AUDIO_BYTES", "25_000_000"))
    TTS_VOICE: str = _env("TTS_VOICE", "en-IN-NeerjaNeural")
    STT_MODEL: str = _env("STT_MODEL", "small")
    EMBED_MODEL: str = _env(
        "EMBED_MODEL", "sentence-transformers/all-MiniLM-L6-v2"
    )

    # Telegram is disabled unless a token AND explicit allow-list are supplied.
    TELEGRAM_BOT_TOKEN: str = _env("TELEGRAM_BOT_TOKEN")
    TELEGRAM_ALLOWED_IDS: str = _env("TELEGRAM_ALLOWED_IDS")
    TELEGRAM_ALLOW_ALL: bool = _bool("TELEGRAM_ALLOW_ALL")

    MQTT_HOST: str = _env("MQTT_HOST")
    MQTT_PORT: int = int(_env("MQTT_PORT", "1883"))
    MQTT_USER: str = _env("MQTT_USER")
    MQTT_PASS: str = _env("MQTT_PASS")
    MQTT_PREFIX: str = _env("MQTT_PREFIX", "friday")

    VERSION: str = "1.3.0"

    def configuration_errors(self) -> list[str]:
        errors: list[str] = []
        if not self.FRIDAY_TOKEN and not self.FRIDAY_ALLOW_INSECURE_LOCAL:
            errors.append(
                "FRIDAY_TOKEN is required (or explicitly set "
                "FRIDAY_ALLOW_INSECURE_LOCAL=true for isolated local development)"
            )
        if self.FRIDAY_TOKEN and len(self.FRIDAY_TOKEN) < 32:
            errors.append("FRIDAY_TOKEN must be at least 32 characters")
        if self.FRIDAY_TOKEN.startswith(("gsk_", "sk-")):
            errors.append("FRIDAY_TOKEN must not be a provider API key")
        if self.BLACKBOX_ENABLED and not self.BLACKBOX_API_KEY:
            errors.append("BLACKBOX_ENABLED=true requires BLACKBOX_API_KEY")
        if self.TELEGRAM_BOT_TOKEN and not (
            self.TELEGRAM_ALLOWED_IDS.strip() or self.TELEGRAM_ALLOW_ALL
        ):
            errors.append(
                "TELEGRAM_BOT_TOKEN requires TELEGRAM_ALLOWED_IDS; setting "
                "TELEGRAM_ALLOW_ALL=true is an explicit unsafe override"
            )
        if self.ACTION_CLAIM_LEASE_SECONDS < 30:
            errors.append("ACTION_CLAIM_LEASE_SECONDS must be at least 30")
        return errors

    def validate_startup(self) -> None:
        """Fail closed before the API, bridges, or persistent stores start."""
        errors = self.configuration_errors()
        if errors:
            raise RuntimeError("Unsafe FRIDAY backend configuration: " + "; ".join(errors))


settings = Settings()
