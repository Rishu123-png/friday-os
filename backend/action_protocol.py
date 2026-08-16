"""FRIDAY Action Protocol v1.0.

This module is deliberately framework-independent: FastAPI exposes it, Android's
web client consumes it, and unit tests exercise the same validation/state machine.
The backend is the brain/queue; the Android client is the capability-aware hands.
"""
from __future__ import annotations

import json
import re
import secrets
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any

PROTOCOL_VERSION = "1.0"
TERMINAL_STATES = {"succeeded", "failed", "unverified", "unsupported", "denied", "expired", "cancelled"}
VALID_VERIFICATION = {"verified", "failed", "unavailable", "not_required"}
VALID_EXECUTION = {"succeeded", "failed", "unsupported", "denied"}


class ProtocolError(ValueError):
    def __init__(self, message: str, code: str = "invalid_action"):
        super().__init__(message)
        self.code = code


# Exactly fifteen daily commands. Schema entries are also used for capability
# filtering and server-derived safety metadata; clients cannot downgrade safety.
ACTION_DEFINITIONS: dict[str, dict[str, Any]] = {
    "device.torch.set": {
        "capability": "torch", "safety": "low", "confirm": False,
        "args": {"enabled": {"type": "bool", "required": True}},
    },
    "device.volume.set": {
        "capability": "volume", "safety": "low", "confirm": False,
        "args": {"percent": {"type": "int", "min": 0, "max": 100, "required": True}},
    },
    "device.brightness.set": {
        "capability": "brightness", "safety": "low", "confirm": False,
        "args": {"percent": {"type": "int", "min": 0, "max": 100, "required": True}},
    },
    "device.wifi.set": {
        "capability": "wifi", "safety": "low", "confirm": False,
        "args": {"enabled": {"type": "bool", "required": True}},
    },
    "device.bluetooth.set": {
        "capability": "bluetooth", "safety": "low", "confirm": False,
        "args": {"enabled": {"type": "bool", "required": True}},
    },
    "media.control": {
        "capability": "media", "safety": "low", "confirm": False,
        "args": {"command": {"type": "str", "choices": ["play", "pause", "next", "previous", "stop", "playpause"], "required": True}},
    },
    "app.open": {
        "capability": "apps", "safety": "low", "confirm": False,
        "args": {"app": {"type": "str", "min_len": 1, "max_len": 100, "required": True}},
    },
    "alarm.create": {
        "capability": "alarms", "safety": "low", "confirm": False,
        "args": {
            "hour": {"type": "int", "min": 0, "max": 23, "required": True},
            "minute": {"type": "int", "min": 0, "max": 59, "required": True},
            "label": {"type": "str", "min_len": 0, "max_len": 120, "default": "FRIDAY"},
            "repeat": {"type": "str", "choices": ["once", "daily", "weekdays", "weekends"], "default": "once"},
        },
    },
    "device.battery.get": {
        "capability": "battery", "safety": "low", "confirm": False, "args": {},
    },
    "device.storage.get": {
        "capability": "storage", "safety": "low", "confirm": False, "args": {},
    },
    "notifications.list": {
        "capability": "notifications", "safety": "medium", "confirm": True,
        "args": {},
    },
    "screen.read": {
        "capability": "screen_read", "safety": "medium", "confirm": True,
        "args": {},
    },
    "screen.capture": {
        "capability": "screenshot", "safety": "medium", "confirm": True,
        "args": {},
    },
    "phone.call": {
        "capability": "phone", "safety": "high", "confirm": True,
        "args": {"number": {"type": "phone", "required": True}},
    },
    "message.sms.send": {
        "capability": "sms", "safety": "high", "confirm": True,
        "args": {
            "number": {"type": "phone", "required": True},
            "body": {"type": "str", "min_len": 1, "max_len": 1000, "required": True},
        },
    },
}

_IDEMPOTENCY_RE = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")
_DEVICE_RE = re.compile(r"^[A-Za-z0-9._:-]{3,128}$")


def _bounded_json(value: Any, name: str, limit: int = 32_000) -> str:
    try:
        encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    except (TypeError, ValueError) as exc:
        raise ProtocolError(f"{name} must be JSON serializable") from exc
    if len(encoded.encode("utf-8")) > limit:
        raise ProtocolError(f"{name} is too large")
    return encoded


def _normalize_arg(name: str, value: Any, rule: dict[str, Any]) -> Any:
    kind = rule["type"]
    if kind == "bool":
        if type(value) is not bool:
            raise ProtocolError(f"args.{name} must be boolean")
        return value
    if kind == "int":
        if type(value) is not int:
            raise ProtocolError(f"args.{name} must be an integer")
        if value < rule.get("min", value) or value > rule.get("max", value):
            raise ProtocolError(f"args.{name} is out of range")
        return value
    if kind == "phone":
        if not isinstance(value, str):
            raise ProtocolError(f"args.{name} must be a phone number string")
        normalized = re.sub(r"[\s().-]", "", value)
        if not re.fullmatch(r"\+?[0-9]{7,15}", normalized):
            raise ProtocolError(f"args.{name} is not a valid phone number")
        return normalized
    if kind == "str":
        if not isinstance(value, str):
            raise ProtocolError(f"args.{name} must be a string")
        value = value.strip()
        if len(value) < rule.get("min_len", 0) or len(value) > rule.get("max_len", 10_000):
            raise ProtocolError(f"args.{name} has an invalid length")
        if "choices" in rule and value not in rule["choices"]:
            raise ProtocolError(f"args.{name} has an unsupported value")
        return value
    raise ProtocolError(f"Internal schema error for args.{name}")


def validate_enqueue(body: Any) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise ProtocolError("JSON object required")
    allowed = {"protocol_version", "type", "args", "idempotency_key", "expires_in_seconds", "safety"}
    unknown = set(body) - allowed
    if unknown:
        raise ProtocolError("Unknown fields: " + ", ".join(sorted(unknown)))
    if body.get("protocol_version") != PROTOCOL_VERSION:
        raise ProtocolError(f"protocol_version must be {PROTOCOL_VERSION}", "unsupported_version")
    action_type = body.get("type")
    definition = ACTION_DEFINITIONS.get(action_type)
    if not definition:
        raise ProtocolError("Unsupported action type", "unsupported_action")
    idem = body.get("idempotency_key")
    if not isinstance(idem, str) or not _IDEMPOTENCY_RE.fullmatch(idem):
        raise ProtocolError("idempotency_key must be 8-128 safe characters")
    expires = body.get("expires_in_seconds", 300)
    if type(expires) is not int or not 30 <= expires <= 86_400:
        raise ProtocolError("expires_in_seconds must be 30-86400")

    supplied_args = body.get("args", {})
    if not isinstance(supplied_args, dict):
        raise ProtocolError("args must be an object")
    rules = definition["args"]
    unknown_args = set(supplied_args) - set(rules)
    if unknown_args:
        raise ProtocolError("Unknown args: " + ", ".join(sorted(unknown_args)))
    args: dict[str, Any] = {}
    for name, rule in rules.items():
        if name in supplied_args:
            args[name] = _normalize_arg(name, supplied_args[name], rule)
        elif rule.get("required"):
            raise ProtocolError(f"args.{name} is required")
        elif "default" in rule:
            args[name] = rule["default"]

    supplied_safety = body.get("safety") or {}
    if not isinstance(supplied_safety, dict) or set(supplied_safety) - {"confirmed"}:
        raise ProtocolError("safety may contain only confirmed")
    confirmed = supplied_safety.get("confirmed", False)
    if type(confirmed) is not bool:
        raise ProtocolError("safety.confirmed must be boolean")

    return {
        "protocol_version": PROTOCOL_VERSION,
        "type": action_type,
        "args": args,
        "idempotency_key": idem,
        "expires_in_seconds": expires,
        "capability": definition["capability"],
        "safety": {
            "level": definition["safety"],
            "confirmation_required": definition["confirm"],
            "confirmed": confirmed if definition["confirm"] else True,
        },
    }


def validate_result(action_id: str, body: Any) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise ProtocolError("JSON object required")
    allowed = {"protocol_version", "action_id", "device_id", "lease_token", "started_at", "finished_at", "execution", "verification"}
    unknown = set(body) - allowed
    if unknown:
        raise ProtocolError("Unknown result fields: " + ", ".join(sorted(unknown)))
    if body.get("protocol_version") != PROTOCOL_VERSION:
        raise ProtocolError(f"protocol_version must be {PROTOCOL_VERSION}", "unsupported_version")
    if body.get("action_id") != action_id:
        raise ProtocolError("action_id does not match URL")
    device_id = body.get("device_id")
    if not isinstance(device_id, str) or not _DEVICE_RE.fullmatch(device_id):
        raise ProtocolError("invalid device_id")
    lease_token = body.get("lease_token")
    if not isinstance(lease_token, str) or len(lease_token) < 20:
        raise ProtocolError("invalid lease_token")

    execution = body.get("execution")
    if not isinstance(execution, dict) or execution.get("status") not in VALID_EXECUTION:
        raise ProtocolError("execution.status is invalid")
    if set(execution) - {"status", "output", "error"}:
        raise ProtocolError("execution has unknown fields")
    output = execution.get("output", {})
    if not isinstance(output, dict):
        raise ProtocolError("execution.output must be an object")
    error = execution.get("error")
    if error is not None and (not isinstance(error, str) or len(error) > 500):
        raise ProtocolError("execution.error is invalid")

    verification = body.get("verification")
    if not isinstance(verification, dict) or verification.get("status") not in VALID_VERIFICATION:
        raise ProtocolError("verification.status is invalid")
    if set(verification) - {"status", "method", "evidence", "detail"}:
        raise ProtocolError("verification has unknown fields")
    method = verification.get("method", "none")
    detail = verification.get("detail", "")
    evidence = verification.get("evidence", {})
    if not isinstance(method, str) or len(method) > 100:
        raise ProtocolError("verification.method is invalid")
    if not isinstance(detail, str) or len(detail) > 500:
        raise ProtocolError("verification.detail is invalid")
    if not isinstance(evidence, dict):
        raise ProtocolError("verification.evidence must be an object")

    started_at, finished_at = body.get("started_at"), body.get("finished_at")
    for name, value in (("started_at", started_at), ("finished_at", finished_at)):
        if not isinstance(value, str) or len(value) > 64:
            raise ProtocolError(f"{name} is required")

    normalized = {
        "protocol_version": PROTOCOL_VERSION,
        "action_id": action_id,
        "device_id": device_id,
        "lease_token": lease_token,
        "started_at": started_at,
        "finished_at": finished_at,
        "execution": {"status": execution["status"], "output": output},
        "verification": {"status": verification["status"], "method": method, "detail": detail, "evidence": evidence},
    }
    if error:
        normalized["execution"]["error"] = error
    _bounded_json(normalized, "result")
    return normalized


class ActionStore:
    def __init__(self, path: str, lease_seconds: int = 90, max_attempts: int = 3):
        self.path = str(path)
        self.lease_seconds = max(30, int(lease_seconds))
        self.max_attempts = max(1, int(max_attempts))
        self._lock = threading.RLock()
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        self._conn.row_factory = sqlite3.Row
        self._init_schema()

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    def _init_schema(self) -> None:
        with self._lock:
            self._conn.executescript("""
                PRAGMA journal_mode=WAL;
                PRAGMA foreign_keys=ON;
                CREATE TABLE IF NOT EXISTS actions (
                    id TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    protocol_version TEXT NOT NULL,
                    type TEXT NOT NULL,
                    args_json TEXT NOT NULL,
                    capability TEXT NOT NULL,
                    safety_json TEXT NOT NULL,
                    state TEXT NOT NULL,
                    idempotency_key TEXT NOT NULL,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL,
                    expires_at INTEGER NOT NULL,
                    claimed_by TEXT,
                    lease_until INTEGER,
                    lease_token TEXT,
                    attempts INTEGER NOT NULL DEFAULT 0,
                    result_json TEXT,
                    UNIQUE(user_id, idempotency_key)
                );
                CREATE INDEX IF NOT EXISTS idx_actions_claim
                    ON actions(user_id, state, expires_at, created_at);
            """)

    @staticmethod
    def _public(row: sqlite3.Row) -> dict[str, Any]:
        item = {
            "protocol_version": row["protocol_version"],
            "action_id": row["id"],
            "type": row["type"],
            "args": json.loads(row["args_json"]),
            "required_capability": row["capability"],
            "safety": json.loads(row["safety_json"]),
            "state": row["state"],
            "created_at": row["created_at"],
            "expires_at": row["expires_at"],
            "attempt": row["attempts"],
        }
        if row["claimed_by"]:
            item["claimed_by"] = row["claimed_by"]
        if row["lease_until"]:
            item["lease_until"] = row["lease_until"]
        if row["result_json"]:
            result = json.loads(row["result_json"])
            result.pop("lease_token", None)
            item["result"] = result
        return item

    def enqueue(self, user_id: str, body: Any, now: int | None = None) -> tuple[dict[str, Any], bool]:
        action = validate_enqueue(body)
        now = int(now or time.time())
        state = "queued" if action["safety"]["confirmed"] else "awaiting_confirmation"
        action_id = str(uuid.uuid4())
        with self._lock:
            try:
                self._conn.execute(
                    """INSERT INTO actions
                    (id,user_id,protocol_version,type,args_json,capability,safety_json,state,
                     idempotency_key,created_at,updated_at,expires_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (action_id, user_id, PROTOCOL_VERSION, action["type"],
                     _bounded_json(action["args"], "args"), action["capability"],
                     _bounded_json(action["safety"], "safety"), state,
                     action["idempotency_key"], now, now,
                     now + action["expires_in_seconds"]),
                )
                created = True
            except sqlite3.IntegrityError:
                created = False
            row = self._conn.execute(
                "SELECT * FROM actions WHERE user_id=? AND idempotency_key=?",
                (user_id, action["idempotency_key"]),
            ).fetchone()
        if row is None:
            raise RuntimeError("Action enqueue failed")
        if not created and (row["type"] != action["type"] or json.loads(row["args_json"]) != action["args"]):
            raise ProtocolError("idempotency_key was already used for different action data", "idempotency_conflict")
        return self._public(row), created

    def get(self, user_id: str, action_id: str, now: int | None = None) -> dict[str, Any] | None:
        now = int(now or time.time())
        with self._lock:
            # Status reads must not present an already-expired action as runnable.
            self._expire_and_requeue(user_id, now)
            row = self._conn.execute(
                "SELECT * FROM actions WHERE id=? AND user_id=?", (action_id, user_id)
            ).fetchone()
        return self._public(row) if row else None

    def confirm(self, user_id: str, action_id: str, now: int | None = None) -> dict[str, Any] | None:
        now = int(now or time.time())
        with self._lock:
            # Confirmation can never revive an action after its expiry deadline.
            self._expire_and_requeue(user_id, now)
            row = self._conn.execute(
                "SELECT * FROM actions WHERE id=? AND user_id=?", (action_id, user_id)
            ).fetchone()
            if row is None:
                return None
            if row["state"] == "awaiting_confirmation":
                safety = json.loads(row["safety_json"])
                safety["confirmed"] = True
                self._conn.execute(
                    "UPDATE actions SET state='queued', safety_json=?, updated_at=? WHERE id=?",
                    (_bounded_json(safety, "safety"), now, action_id),
                )
                row = self._conn.execute("SELECT * FROM actions WHERE id=?", (action_id,)).fetchone()
        return self._public(row)

    def cancel(self, user_id: str, action_id: str, now: int | None = None) -> dict[str, Any] | None:
        now = int(now or time.time())
        with self._lock:
            self._expire_and_requeue(user_id, now)
            row = self._conn.execute(
                "SELECT * FROM actions WHERE id=? AND user_id=?", (action_id, user_id)
            ).fetchone()
            if row is None:
                return None
            if row["state"] == "claimed":
                raise ProtocolError(
                    "Action is already executing; cancellation can no longer be guaranteed",
                    "invalid_state",
                )
            if row["state"] not in TERMINAL_STATES:
                self._conn.execute(
                    "UPDATE actions SET state='cancelled', lease_token=NULL, updated_at=? WHERE id=?",
                    (now, action_id),
                )
                row = self._conn.execute("SELECT * FROM actions WHERE id=?", (action_id,)).fetchone()
        return self._public(row)

    def _expire_and_requeue(self, user_id: str, now: int) -> None:
        self._conn.execute(
            "UPDATE actions SET state='expired', lease_token=NULL, updated_at=? "
            "WHERE user_id=? AND state NOT IN ('succeeded','failed','unverified','unsupported','denied','expired','cancelled') AND expires_at<=?",
            (now, user_id, now),
        )
        self._conn.execute(
            "UPDATE actions SET state='queued', claimed_by=NULL, lease_until=NULL, lease_token=NULL, updated_at=? "
            "WHERE user_id=? AND state='claimed' AND lease_until<=? AND attempts<? AND expires_at>?",
            (now, user_id, now, self.max_attempts, now),
        )
        self._conn.execute(
            "UPDATE actions SET state='failed', lease_token=NULL, updated_at=? "
            "WHERE user_id=? AND state='claimed' AND lease_until<=? AND attempts>=?",
            (now, user_id, now, self.max_attempts),
        )

    def claim(self, user_id: str, device_id: str, capabilities: set[str], now: int | None = None) -> dict[str, Any] | None:
        if not _DEVICE_RE.fullmatch(device_id or ""):
            raise ProtocolError("invalid device_id")
        capabilities = {str(x) for x in capabilities if isinstance(x, str) and len(x) <= 64}
        now = int(now or time.time())
        with self._lock:
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                self._expire_and_requeue(user_id, now)
                rows = self._conn.execute(
                    "SELECT * FROM actions WHERE user_id=? AND state='queued' AND expires_at>? ORDER BY created_at,id LIMIT 100",
                    (user_id, now),
                ).fetchall()
                row = next((r for r in rows if r["capability"] in capabilities), None)
                if row is None:
                    self._conn.execute("COMMIT")
                    return None
                token = secrets.token_urlsafe(24)
                lease_until = now + self.lease_seconds
                updated = self._conn.execute(
                    "UPDATE actions SET state='claimed', claimed_by=?, lease_until=?, lease_token=?, attempts=attempts+1, updated_at=? "
                    "WHERE id=? AND state='queued'",
                    (device_id, lease_until, token, now, row["id"]),
                ).rowcount
                if updated != 1:
                    self._conn.execute("ROLLBACK")
                    return None
                row = self._conn.execute("SELECT * FROM actions WHERE id=?", (row["id"],)).fetchone()
                self._conn.execute("COMMIT")
            except Exception:
                self._conn.execute("ROLLBACK")
                raise
        item = self._public(row)
        item["lease_token"] = token
        return item

    def submit_result(self, user_id: str, action_id: str, body: Any, now: int | None = None) -> dict[str, Any] | None:
        result = validate_result(action_id, body)
        now = int(now or time.time())
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM actions WHERE id=? AND user_id=?", (action_id, user_id)
            ).fetchone()
            if row is None:
                return None
            if row["state"] in TERMINAL_STATES:
                return self._public(row)
            if row["state"] != "claimed":
                raise ProtocolError("Action is not currently claimed", "invalid_state")
            if row["claimed_by"] != result["device_id"] or not secrets.compare_digest(row["lease_token"] or "", result["lease_token"]):
                raise ProtocolError("Claim lease does not match", "lease_mismatch")

            execution_status = result["execution"]["status"]
            verification_status = result["verification"]["status"]
            if execution_status == "unsupported":
                state = "unsupported"
            elif execution_status == "denied":
                state = "denied"
            elif execution_status != "succeeded":
                state = "failed"
            elif verification_status == "verified":
                state = "succeeded"
            elif verification_status == "failed":
                state = "failed"
            else:
                state = "unverified"
            self._conn.execute(
                "UPDATE actions SET state=?, result_json=?, lease_token=NULL, updated_at=? WHERE id=?",
                (state, _bounded_json(result, "result"), now, action_id),
            )
            row = self._conn.execute("SELECT * FROM actions WHERE id=?", (action_id,)).fetchone()
        return self._public(row)
