#!/usr/bin/env python3
"""Generate protocol/action-v1.schema.json from backend/action_protocol.py."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from action_protocol import ACTION_DEFINITIONS, PROTOCOL_VERSION  # noqa: E402


def arg_schema(rule):
    kind = rule["type"]
    if kind == "bool":
        out = {"type": "boolean"}
    elif kind == "int":
        out = {"type": "integer", "minimum": rule["min"], "maximum": rule["max"]}
    elif kind == "phone":
        out = {"type": "string", "pattern": r"^\+?[0-9][0-9 .()\-]{6,18}$"}
    else:
        out = {"type": "string", "minLength": rule.get("min_len", 0), "maxLength": rule.get("max_len", 10_000)}
        if "choices" in rule:
            out["enum"] = rule["choices"]
    if "default" in rule:
        out["default"] = rule["default"]
    return out


action_variants = []
for action_type, definition in ACTION_DEFINITIONS.items():
    props = {name: arg_schema(rule) for name, rule in definition["args"].items()}
    required = [name for name, rule in definition["args"].items() if rule.get("required")]
    args = {"type": "object", "additionalProperties": False, "properties": props}
    if required:
        args["required"] = required
    action_variants.append({
        "type": "object",
        "additionalProperties": False,
        "required": ["protocol_version", "type", "args", "idempotency_key"],
        "properties": {
            "protocol_version": {"const": PROTOCOL_VERSION},
            "type": {"const": action_type},
            "args": args,
            "idempotency_key": {"type": "string", "pattern": r"^[A-Za-z0-9._:-]{8,128}$"},
            "expires_in_seconds": {"type": "integer", "minimum": 30, "maximum": 86400, "default": 300},
            "safety": {
                "type": "object", "additionalProperties": False,
                "properties": {"confirmed": {"type": "boolean", "default": False}},
            },
        },
    })

schema = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://friday-os.local/protocol/action-v1.schema.json",
    "title": "FRIDAY Action Protocol v1.0",
    "description": "Versioned backend-to-Android action and result envelopes.",
    "$defs": {
        "ActionRequest": {"oneOf": action_variants},
        "ActionResult": {
            "type": "object", "additionalProperties": False,
            "required": ["protocol_version", "action_id", "device_id", "lease_token", "started_at", "finished_at", "execution", "verification"],
            "properties": {
                "protocol_version": {"const": PROTOCOL_VERSION},
                "action_id": {"type": "string", "format": "uuid"},
                "device_id": {"type": "string", "pattern": r"^[A-Za-z0-9._:-]{3,128}$"},
                "lease_token": {"type": "string", "minLength": 20},
                "started_at": {"type": "string", "format": "date-time"},
                "finished_at": {"type": "string", "format": "date-time"},
                "execution": {
                    "type": "object", "additionalProperties": False,
                    "required": ["status", "output"],
                    "properties": {
                        "status": {"enum": ["succeeded", "failed", "unsupported", "denied"]},
                        "output": {"type": "object"},
                        "error": {"type": "string", "maxLength": 500},
                    },
                },
                "verification": {
                    "type": "object", "additionalProperties": False,
                    "required": ["status", "method", "evidence"],
                    "properties": {
                        "status": {"enum": ["verified", "failed", "unavailable", "not_required"]},
                        "method": {"type": "string", "maxLength": 100},
                        "detail": {"type": "string", "maxLength": 500},
                        "evidence": {"type": "object"},
                    },
                },
            },
        },
    },
    "oneOf": [
        {"$ref": "#/$defs/ActionRequest"},
        {"$ref": "#/$defs/ActionResult"},
    ],
}

out = ROOT / "protocol" / "action-v1.schema.json"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(schema, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(out.relative_to(ROOT))
