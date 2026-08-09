"""Trusted cloud-provider gateway.

Keys are read only from server environment variables. Provider errors are
sanitized and never include request headers, keys, or full response bodies.
Routing is Groq first, then Blackbox only when explicitly enabled and the
operator has explicitly allow-listed the model as free for their account.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from config import settings

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
# Official public endpoint documented by BLACKBOX AI.
BLACKBOX_URL = "https://api.blackbox.ai/chat/completions"


@dataclass(frozen=True)
class ProviderSpec:
    name: str
    url: str
    key: str
    model: str


def _free_models() -> set[str]:
    return {x.strip() for x in settings.BLACKBOX_FREE_MODELS.split(",") if x.strip()}


def blackbox_eligibility() -> tuple[bool, str]:
    if not settings.BLACKBOX_ENABLED:
        return False, "disabled"
    if not settings.BLACKBOX_API_KEY:
        return False, "missing_key"
    if not settings.BLACKBOX_MODEL:
        return False, "missing_model"
    # BLACKBOX does not expose reliable free-tier metadata in its model list.
    # Requiring this explicit allow-list prevents accidental paid-model use.
    if settings.BLACKBOX_MODEL not in _free_models():
        return False, "free_access_not_attested"
    return True, "configured"


def configured_providers() -> list[ProviderSpec]:
    out: list[ProviderSpec] = []
    if settings.GROQ_API_KEY:
        out.append(ProviderSpec("groq", GROQ_URL, settings.GROQ_API_KEY, settings.GROQ_MODEL))
    bb_ok, _ = blackbox_eligibility()
    if bb_ok:
        out.append(ProviderSpec("blackbox", BLACKBOX_URL, settings.BLACKBOX_API_KEY, settings.BLACKBOX_MODEL))
    return out


def provider_status() -> dict[str, dict[str, Any]]:
    bb_ok, bb_reason = blackbox_eligibility()
    return {
        "groq": {"configured": bool(settings.GROQ_API_KEY), "model": settings.GROQ_MODEL if settings.GROQ_API_KEY else ""},
        "blackbox": {
            "configured": bb_ok, "enabled": settings.BLACKBOX_ENABLED,
            "reason": bb_reason, "model": settings.BLACKBOX_MODEL if bb_ok else ""
        },
    }


def _safe_error(name: str, status: int) -> RuntimeError:
    if status in (401, 403):
        return RuntimeError(f"{name.upper()}_BAD_KEY_OR_ACCESS")
    if status == 429:
        return RuntimeError(f"{name.upper()}_RATE_LIMIT")
    if status == 402:
        return RuntimeError(f"{name.upper()}_PAID_ACCESS_REQUIRED")
    return RuntimeError(f"{name.upper()}_HTTP_{status}")


async def complete(
    messages: list,
    *,
    tools: list | None = None,
    stream: bool = False,
    max_tokens: int = 900,
    temperature: float = 0.6,
    model: str | None = None,
    client: Any = None,
) -> dict:
    """Try configured providers in policy order and return OpenAI-style JSON."""
    providers = configured_providers()
    if not providers:
        raise RuntimeError("NO_CLOUD_PROVIDER_CONFIGURED")

    errors: list[str] = []
    owns_client = client is None
    c = client or httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0))
    try:
        for spec in providers:
            body: dict[str, Any] = {
                "model": (model if spec.name == "groq" and model else spec.model),
                "messages": messages,
                "max_tokens": max_tokens,
                "temperature": temperature,
                "stream": stream,
            }
            if tools:
                body["tools"] = tools
                body["tool_choice"] = "auto"
            try:
                response = await c.post(spec.url, json=body, headers={
                    "Authorization": f"Bearer {spec.key}", "Content-Type": "application/json"
                })
                if response.status_code != 200:
                    raise _safe_error(spec.name, response.status_code)
                data = response.json()
                if not data.get("choices"):
                    raise RuntimeError(f"{spec.name.upper()}_EMPTY_RESPONSE")
                data["_friday_provider"] = spec.name
                return data
            except (httpx.HTTPError, ValueError) as exc:
                errors.append(f"{spec.name}:network_or_invalid_response")
            except RuntimeError as exc:
                errors.append(str(exc))
    finally:
        if owns_client:
            await c.aclose()
    raise RuntimeError("CLOUD_UNAVAILABLE — " + " | ".join(errors))
