"""Deterministic everyday-device command extraction for Action Protocol v1.0.

The LLM remains the conversational brain, but these high-frequency commands do
not depend on a cloud model being available. Every extracted command is still
validated by ``ActionStore.enqueue`` before it can reach an Android device.
"""
from __future__ import annotations

import re
from typing import Any

from action_protocol import ACTION_DEFINITIONS

_PHONE = r"\+?[0-9][0-9\s().-]{5,18}[0-9]"
_CONFIRM_YES = re.compile(r"^\s*(yes|yeah|yep|confirm|confirmed|go|go ahead|do it|proceed|haan|han|ha|kar do|kardo|pakka)\s*[.!]?\s*$", re.I)
_CONFIRM_NO = re.compile(r"^\s*(no|nope|cancel|stop|don't|do not|nah|nahi|mat karo|rehne do)\s*[.!]?\s*$", re.I)


def confirmation_reply(text: str) -> str | None:
    """Return ``confirm``/``cancel`` only for an unambiguous short reply."""
    if _CONFIRM_YES.fullmatch(text or ""):
        return "confirm"
    if _CONFIRM_NO.fullmatch(text or ""):
        return "cancel"
    return None


def _toggle(text: str) -> bool | None:
    if re.search(r"\b(on|enable|start|activate|chalu|chalao)\b", text):
        return True
    if re.search(r"\b(off|disable|stop|deactivate|band)\b", text):
        return False
    return None


def _percent(text: str) -> int | None:
    match = re.search(r"\b(100|[1-9]?[0-9])\s*(?:%|percent|percentage)?\b", text)
    return int(match.group(1)) if match else None


def _normalize_phone(value: str) -> str:
    return re.sub(r"[\s().-]", "", value)


def _action(action_type: str, args: dict[str, Any], summary: str) -> dict[str, Any]:
    return {"type": action_type, "args": args, "summary": summary}


def resolve_device_command(text: str) -> dict[str, Any] | None:
    """Extract one of the 15 supported daily commands, or return ``None``.

    Matching is intentionally conservative. Missing phone numbers, alarm times,
    or message bodies are left to the conversational model to clarify rather
    than guessed.
    """
    original = str(text or "").strip()
    t = re.sub(r"\s+", " ", original.lower()).strip()
    if not t or len(t) > 2_000:
        return None

    # Read-only device facts.
    if re.search(r"\b(battery (?:level|status|percentage|percent)|how much battery|charge left|battery kitni)\b", t):
        return _action("device.battery.get", {}, "check your battery")
    if re.search(r"\b(storage (?:left|free|status|space)|free storage|disk space|space left|storage kitni)\b", t):
        return _action("device.storage.get", {}, "check free storage")
    if re.search(r"\b(read|show|list|check|tell me)\b.{0,20}\bnotifications?\b|\bwhat notifications?\b", t):
        return _action("notifications.list", {}, "read active notifications")
    if re.search(r"\b(take|capture|make)\b.{0,12}\bscreen\s*shot\b|\bscreenshot\b", t):
        return _action("screen.capture", {}, "capture the screen")
    if re.search(r"\b(read|scan|describe|what(?:'s| is))\b.{0,18}\b(?:my |the |this )?screen\b|\bread screen\b", t):
        return _action("screen.read", {}, "read the current screen")

    # Device setters.
    if re.search(r"\b(torch|flashlight|flash light)\b", t):
        enabled = _toggle(t)
        if enabled is not None:
            return _action("device.torch.set", {"enabled": enabled}, f"turn the flashlight {'on' if enabled else 'off'}")

    if re.search(r"\bvolume\b", t):
        if re.search(r"\b(mute|silent|zero)\b", t):
            pct = 0
        elif re.search(r"\b(max|maximum|full)\b", t):
            pct = 100
        else:
            pct = _percent(t)
        if pct is not None:
            return _action("device.volume.set", {"percent": pct}, f"set media volume to {pct}%")

    if re.search(r"\bbrightness\b", t):
        if re.search(r"\b(min|minimum|lowest)\b", t):
            pct = 0
        elif re.search(r"\b(max|maximum|full)\b", t):
            pct = 100
        else:
            pct = _percent(t)
        if pct is not None:
            return _action("device.brightness.set", {"percent": pct}, f"set brightness to {pct}%")

    if re.search(r"\bwi[ -]?fi\b", t):
        enabled = _toggle(t)
        if enabled is not None:
            return _action("device.wifi.set", {"enabled": enabled}, f"turn Wi-Fi {'on' if enabled else 'off'}")

    if re.search(r"\bbluetooth\b", t):
        enabled = _toggle(t)
        if enabled is not None:
            return _action("device.bluetooth.set", {"enabled": enabled}, f"turn Bluetooth {'on' if enabled else 'off'}")

    media = re.fullmatch(r"(?:please\s+)?(play|pause|stop|next|previous|playpause)(?:\s+(?:the\s+)?(?:music|song|media|track))?[.!]?", t)
    if media:
        command = media.group(1)
        return _action("media.control", {"command": command}, f"send the media {command} command")

    # Alarm time: accepts 7, 7:30, 07:30, 7 am, 7:30 pm.
    if re.search(r"\b(set|create|add|wake me)\b.{0,20}\balarm\b|\balarm\b.{0,12}\b(?:at|for)\b", t):
        match = re.search(r"\b(?:at|for)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b", t)
        if match:
            hour = int(match.group(1))
            minute = int(match.group(2) or 0)
            ampm = match.group(3)
            if ampm and 1 <= hour <= 12:
                hour = hour % 12 + (12 if ampm == "pm" else 0)
            if 0 <= hour <= 23 and 0 <= minute <= 59:
                label_match = re.search(r"\b(?:called|label(?:led)?|named)\s+(.{1,80})$", original, re.I)
                label = label_match.group(1).strip(" .") if label_match else "FRIDAY"
                return _action(
                    "alarm.create",
                    {"hour": hour, "minute": minute, "label": label, "repeat": "once"},
                    f"create an alarm for {hour:02d}:{minute:02d}",
                )

    # Communications require literal numbers. Contact-name resolution belongs
    # on the trusted Android side and is never guessed by the backend.
    sms = re.search(
        rf"\b(?:send|text)\s+(?:an?\s+)?(?:sms|message)\s+(?:to\s+)?(?P<number>{_PHONE})\s+(?:saying|that says|message|text|:)?\s*(?P<body>.+)$",
        original,
        re.I,
    )
    if sms:
        number = _normalize_phone(sms.group("number"))
        body = sms.group("body").strip()
        if body:
            return _action("message.sms.send", {"number": number, "body": body}, f"send an SMS to {number}")

    call = re.search(rf"\b(?:call|dial|phone)\s+(?P<number>{_PHONE})\s*$", original, re.I)
    if call:
        number = _normalize_phone(call.group("number"))
        return _action("phone.call", {"number": number}, f"call {number}")

    # App launch is last because "open" also occurs in web/content requests.
    app = re.fullmatch(r"(?:please\s+)?(?:open|launch|start)\s+(?:the\s+)?(.{1,100}?)(?:\s+app)?[.!]?", original, re.I)
    if app:
        name = app.group(1).strip(" .")
        if name and not re.search(r"\b(https?://|website|web page|url|link)\b", name, re.I):
            return _action("app.open", {"app": name}, f"open {name}")

    return None


def device_action_tool_schema() -> dict[str, Any]:
    """One typed LLM tool whose output is revalidated by ActionStore."""
    return {
        "type": "function",
        "function": {
            "name": "device_action",
            "description": (
                "Queue one Android phone action. This only queues/requests the action; "
                "it does not prove completion. Never call it when a required detail is missing."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "type": {"type": "string", "enum": list(ACTION_DEFINITIONS)},
                    "args": {"type": "object", "additionalProperties": True},
                },
                "required": ["type", "args"],
            },
        },
    }


def normalize_device_tool(arguments: Any) -> dict[str, Any]:
    """Return only protocol type/args; ActionStore performs final validation."""
    if not isinstance(arguments, dict):
        raise ValueError("device_action arguments must be an object")
    action_type = arguments.get("type")
    args = arguments.get("args")
    if action_type not in ACTION_DEFINITIONS or not isinstance(args, dict):
        raise ValueError("device_action type or args are invalid")
    return {"type": action_type, "args": args}
