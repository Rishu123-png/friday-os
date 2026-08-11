# FRIDAY OS — LLM proxy (Groq) with a bounded multi-round agent tool loop.
#
# Upgraded from single-pass → bounded multi-round agent loop.
# The model can call tools, see real results, and call more tools
# until the task is done or MAX_TOOL_ROUNDS is reached.
#
# Mirrors the on-device agent loop (agent/orchestrator.js) so behavior
# is consistent whether the brain runs on-phone or on-server.
#
# Run:  uvicorn main:app --host 0.0.0.0 --port 8000   (from backend/)
# Docs: GET /docs

import json
import re
import time
from typing import AsyncGenerator


from config import settings
from cloud_providers import complete
from tools import TOOL_RUNNERS, TOOL_SCHEMAS
from memory import memory_brief

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

# Maximum tool-call rounds per chat request. Prevents infinite agent loops.
MAX_TOOL_ROUNDS = 5

# Tools the LLM is allowed to call. Same schemas as the on-device agent.
SERVER_TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Current weather + 3-day forecast at lat/lon (default Delhi). "
                           "ALWAYS call this when the user asks about weather — never guess.",
            "parameters": {
                "type": "object",
                "properties": {"lat": {"type": "number"}, "lon": {"type": "number"}},
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_knowledge",
            "description": "Look up facts/people/places via Wikipedia. "
                           "Use for 'who is X', 'what is X', 'tell me about X'.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "tell_time",
            "description": "Current date and time. Use when the user asks the time.",
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "translate_text",
            "description": "Translate text to a target language code (hi, en, es, fr, de...).",
            "parameters": {
                "type": "object",
                "properties": {"text": {"type": "string"}, "to": {"type": "string"}},
                "required": ["text"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "fetch_web",
            "description": "Read a web page's text content by URL. Use when the user shares a link or asks about a specific website.",
            "parameters": {
                "type": "object",
                "properties": {"url": {"type": "string"}},
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "smart_home",
            "description": "Control smart-home devices via MQTT (Home Assistant/ESPHome/Tasmota). "
                           "device: 'light', 'fan', 'ac', etc. command: 'on', 'off', 'toggle'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "device": {"type": "string"},
                    "command": {"type": "string", "enum": ["on", "off", "toggle"]},
                },
                "required": ["device", "command"],
            },
        },
    },
]


def _system_prompt(brief: str) -> str:
    return (
        "You are FRIDAY, a personal AI assistant OS on the user's Android phone, "
        "inspired by Iron Man's AI. Keep replies short and conversational — they are "
        "often read aloud by TTS. Never use markdown headers or bullet lists unless asked.\n\n"

        "TOOL LOOP RULES (non-negotiable):\n"
        "- You have access to tools. Call a tool when you need real data or need to DO something.\n"
        "- When you call a tool, you WILL get the real result in the next message from the system.\n"
        "- NEVER invent tool results or pretend you completed an action. Use ONLY what the tool returns.\n"
        "- If a tool says it failed or needs permission, tell the user honestly and explain how to fix it.\n"
        "- For device actions (weather, time, knowledge, web): call the tool, get the result, THEN respond.\n"
        "- If the tool confirms success, say what actually happened — never say 'Done' without evidence.\n"
        "- If the tool fails, explain why honestly.\n"
        "- AMBIGUITY: if a request is ambiguous or missing a critical detail, ask ONE short clarifying "
        "question and stop — do not guess.\n\n"

        "ABOUT THE USER (from memory, use naturally, never recite back):\n"
        f"{brief}"

        "\nToday is " + time.strftime("%A %d %B %Y") + ".\n"

        "\nWhen you have everything you need, respond with a final answer — short, warm, conversational. "
        "End with one short follow-up question when it fits naturally."
    )


async def _groq(messages: list, *, tools=None, stream: bool = False,
                max_tokens: int = 900, temperature: float = 0.6,
                model: str | None = None) -> dict:
    """Compatibility wrapper around the trusted Groq → Blackbox gateway."""
    return await complete(messages, tools=tools, stream=stream,
                          max_tokens=max_tokens, temperature=temperature,
                          model=model)


def _wants_tools(history: list) -> bool:
    """Heuristic: only advertise tools when the latest user message actually
    asks for live data or an action. Some Groq models occasionally emit a
    malformed tool call (name+args glued together, e.g.
    `search_knowledge{"query": ...}`) on open-ended chat, which Groq rejects
    with HTTP 400 and kills the whole reply. Plain conversation doesn't need
    tools, so routing it tool-free removes that whole failure class while
    weather/time/knowledge/translate/web/smart-home still call tools."""
    last = ""
    for m in reversed(history):
        if m.get("role") == "user":
            last = str(m.get("content") or "").lower()
            break
    if not last:
        return False
    patterns = [
        r"\bweather\b", r"\bforecast\b", r"\brain\b", r"\btemperature\b",
        r"\bwhat(?:'s| is)? the time\b", r"\bwhat time\b", r"\bcurrent time\b",
        r"\bdate (today|now)\b", r"\btoday'?s? date\b",
        r"\bwho is\b", r"\bwhat is\b", r"\bwho (was|are)\b",
        r"\btell me about\b", r"\blook up\b", r"\bwikipedia\b",
        r"\btranslate\b", r"\bin (hindi|english|spanish|french|german)\b",
        r"\bhttps?://\b", r"\bfetch\b", r"\bopen (the |that )?(url|website|site|page)\b",
        r"\bturn (on|off)\b", r"\bsmart home\b", r"\bswitch (on|off)\b",
        r"\b(lights?|fan|ac|air conditioner)\b.*\b(on|off)\b",
    ]
    return any(re.search(p, last) for p in patterns)


async def run_tool_loop(history: list, brief: str) -> AsyncGenerator[dict, None]:
    """
    Bounded multi-round agent tool loop.

    Flow:
      1. Send messages + tool schemas to Groq
      2. If model calls tools → execute each tool → feed results back
      3. Loop back to step 1 (model sees real tool results)
      4. Stop when: model produces final text, max rounds reached, or error

    Yields:
        {'type': 'token',  'text': ...}  — streamed answer tokens
        {'type': 'tool',   'name': ..., 'result': ...} — tool execution events
        {'type': 'done'}                  — stream complete
        {'type': 'error',  'message': ...} — error events
    """
    messages = [{"role": "system", "content": _system_prompt(brief)}, *history]
    use_tools = _wants_tools(history)

    for round_num in range(1, MAX_TOOL_ROUNDS + 1):
        # --- Pass: get model response (with tools only when relevant) ---
        try:
            data = await _groq(
                messages,
                tools=SERVER_TOOL_SCHEMAS if use_tools else None,
                stream=False,
                max_tokens=500,
                temperature=0.3,
            )
        except RuntimeError as e:
            # If a malformed tool call 400s on a tool-enabled request, retry
            # once without tools so the user still gets an answer instead of
            # a dead "connection failed".
            msg = str(e)
            if use_tools and "400" in msg:
                use_tools = False
                try:
                    data = await _groq(
                        messages,
                        tools=None,
                        stream=False,
                        max_tokens=500,
                        temperature=0.3,
                    )
                except RuntimeError as e2:
                    yield {"type": "error", "message": str(e2)}
                    return
            else:
                yield {"type": "error", "message": msg}
                return

        first = data["choices"][0]["message"]

        # --- Case 1: model produced tool calls ---
        if first.get("tool_calls"):
            messages.append({
                "role": "assistant",
                "content": first.get("content") or "",
                "tool_calls": first["tool_calls"],
            })

            for tc in first["tool_calls"]:
                fn = tc.get("function", {})
                name = fn.get("name", "")
                try:
                    args = json.loads(fn.get("arguments") or "{}")
                except Exception:
                    args = {}

                runner = TOOL_RUNNERS.get(name)
                if runner:
                    try:
                        result = await runner(args)
                    except Exception as e:
                        result = f"Tool error: {e}"
                else:
                    result = f"Unknown tool: {name}"

                result_str = str(result)[:2000]  # cap context pollution

                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.get("id"),
                    "name": name,
                    "content": result_str,
                })

                yield {
                    "type": "tool",
                    "name": name,
                    "result": result_str[:120],
                }

            # Loop back — model sees tool results and can call more tools
            # or produce a final answer
            continue

        # --- Case 2: model produced text (final answer) ---
        if first.get("content"):
            # Stream the final answer
            final_text = first["content"]
            for chunk in final_text:
                yield {"type": "token", "text": chunk}
            yield {"type": "done"}
            return

        # --- Case 3: empty response (shouldn't happen, but handle gracefully) ---
        yield {"type": "error", "message": "Empty response from AI"}
        return

    # Max rounds reached without a final answer
    yield {
        "type": "error",
        "message": f"Agent loop hit max rounds ({MAX_TOOL_ROUNDS}). "
                   "The request may be too complex — try breaking it up.",
    }
