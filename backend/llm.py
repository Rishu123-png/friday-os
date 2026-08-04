# FRIDAY OS — LLM proxy (Groq) with a server-side tool loop.
# Mirrors the on-device agent loop (ai.js callGroqTools + app.js runToolByName)
# so the app's behavior is identical whether the brain is on-phone or on-server.
import json
from typing import AsyncGenerator

import httpx

from config import settings
from tools import TOOL_RUNNERS, TOOL_SCHEMAS
from memory import memory_brief

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
SYSTEM_CORE = (
    "You are FRIDAY, a personal AI assistant OS on the user's Android phone, inspired by Iron Man's AI. "
    "Keep replies short and conversational — they are often read aloud by TTS. "
    "Never use markdown headers or bullet lists unless asked. "
    "For anything about the user's phone, call the matching tool and answer ONLY from its result. "
    "Never claim you did something a tool didn't confirm. "
    "If a request is ambiguous, ask ONE short clarifying question and stop. "
    "When it fits, end with one short follow-up question."
)

SYSTEM_BRIEF = (
    "\n\nABOUT THE USER (from memory, use naturally, never recite back):\n{brief}"
)


def _system_prompt(brief: str) -> str:
    return SYSTEM_CORE + (SYSTEM_BRIEF.format(brief=brief) if brief else "")


async def _groq(messages: list, *, tools=None, stream: bool = False,
                max_tokens: int = 900, temperature: float = 0.6, model: str | None = None):
    if not settings.GROQ_API_KEY:
        raise RuntimeError("SERVER_NO_KEY — set GROQ_API_KEY in .env")
    body = {
        "model": model or settings.GROQ_MODEL,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "stream": stream,
    }
    if tools:
        body["tools"] = tools
        body["tool_choice"] = "auto"
    headers = {
        "Authorization": f"Bearer {settings.GROQ_API_KEY}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0)) as c:
        r = await c.post(GROQ_URL, json=body, headers=headers)
    if r.status_code == 401:
        raise RuntimeError("SERVER_BAD_KEY — GROQ_API_KEY is wrong in .env")
    if r.status_code == 429:
        raise RuntimeError("SERVER_RATE_LIMIT — Groq is busy, retry in a moment")
    if r.status_code != 200:
        raise RuntimeError(f"SERVER_HTTP_{r.status_code}: {r.text[:200]}")
    return r.json()


async def run_tool_loop(history: list, brief: str) -> AsyncGenerator[dict, None]:
    """First pass with tools; if the model asks for tools, run them and
    stream the final answer. Yields {'token'|'tool'|'done', ...} events."""
    messages = [{"role": "system", "content": _system_prompt(brief)}, *history]

    # --- pass 1: tool detection ---
    data = await _groq(messages, tools=TOOL_SCHEMAS, stream=False, max_tokens=400, temperature=0.3)
    first = data["choices"][0]["message"]

    if first.get("tool_calls"):
        messages.append({"role": "assistant", "content": first.get("content") or "",
                         "tool_calls": first["tool_calls"]})
        for tc in first["tool_calls"]:
            fn = tc.get("function", {})
            name = fn.get("name", "")
            try:
                args = json.loads(fn.get("arguments") or "{}")
            except Exception:
                args = {}
            runner = TOOL_RUNNERS.get(name)
            result = await runner(args) if runner else f"Unknown tool {name}"
            messages.append({"role": "tool", "tool_call_id": tc.get("id"),
                             "name": name, "content": str(result)})
            yield {"type": "tool", "name": name, "result": str(result)[:120]}

    # --- pass 2: streamed final answer ---
    body = {
        "model": settings.GROQ_MODEL,
        "messages": messages,
        "max_tokens": 900,
        "temperature": 0.6,
        "stream": True,
    }
    headers = {"Authorization": f"Bearer {settings.GROQ_API_KEY}",
               "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as c:
        async with c.stream("POST", GROQ_URL, json=body, headers=headers) as resp:
            if resp.status_code != 200:
                text = await resp.aread()
                raise RuntimeError(f"SERVER_HTTP_{resp.status_code}: {text[:200]}")
            async for line in resp.aiter_lines():
                line = line.strip()
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if payload == "[DONE]":
                    break
                try:
                    delta = json.loads(payload)["choices"][0]["delta"]
                    tok = delta.get("content")
                    if tok:
                        yield {"type": "token", "text": tok}
                except Exception:
                    continue
    yield {"type": "done"}
