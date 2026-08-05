# FRIDAY OS — Vision (multimodal image description)
# Server-side /v1/vision: describe a shared/captured image with a vision LLM.
# Uses the same Groq API key as the brain; model configurable via env.
import base64
import httpx

from config import settings

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"


async def describe_image(image_b64: str, question: str = "") -> str:
    """Returns a plain-text description. Raises RuntimeError with a friendly
    message when the server has no key or the provider errors."""
    if not settings.GROQ_API_KEY:
        raise RuntimeError("SERVER_NO_KEY — set GROQ_API_KEY in .env (vision needs it)")

    payload = image_b64
    if "," in payload[:64] and payload.lstrip().startswith(("data:", "data :")):
        # strip a possible data:image/...;base64, prefix
        payload = payload.split(",", 1)[1]

    body = {
        "model": settings.GROQ_VISION_MODEL,
        "max_tokens": 420,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": (question or "Describe what is in this image") +
                 ". Answer in 3-5 short lines, plain words, practical."},
                {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + payload}}
            ]
        }]
    }
    headers = {"Authorization": f"Bearer {settings.GROQ_API_KEY}",
               "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as c:
        r = await c.post(GROQ_URL, json=body, headers=headers)
    if r.status_code == 401:
        raise RuntimeError("SERVER_BAD_KEY — GROQ_API_KEY is wrong in .env")
    if r.status_code == 429:
        raise RuntimeError("SERVER_RATE_LIMIT — vision is busy, retry in a moment")
    if r.status_code != 200:
        raise RuntimeError(f"SERVER_HTTP_{r.status_code}: {r.text[:200]}")
    out = r.json().get("choices", [{}])[0].get("message", {}).get("content", "").strip()
    if not out:
        raise RuntimeError("SERVER_EMPTY — vision model returned nothing")
    return out
