# FRIDAY OS — Per-user memory (SQLite). Facts/notes survive restarts and
# sync across devices through this single store.
import json
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path

from config import settings

_lock = threading.Lock()
_conn = None


def _get_conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        Path(settings.DB_PATH).parent.mkdir(parents=True, exist_ok=True)
        _conn = sqlite3.connect(settings.DB_PATH, check_same_thread=False)
        _conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                facts TEXT NOT NULL DEFAULT '[]',
                notes TEXT NOT NULL DEFAULT '[]',
                updated_at INTEGER NOT NULL DEFAULT 0
            );
            """
        )
    return _conn


@contextmanager
def _cursor():
    with _lock:
        c = _get_conn().cursor()
        try:
            yield c
            _get_conn().commit()
        finally:
            c.close()


def _row(user_id: str):
    with _cursor() as c:
        c.execute("SELECT facts, notes FROM users WHERE id=?", (user_id,))
        r = c.fetchone()
    return r


def ensure_user(user_id: str) -> None:
    if _row(user_id) is None:
        with _cursor() as c:
            c.execute("INSERT INTO users (id, updated_at) VALUES (?, ?)",
                      (user_id, int(__import__("time").time())))


def get_facts(user_id: str) -> list:
    r = _row(user_id)
    return json.loads(r[0]) if r and r[0] else []


def get_notes(user_id: str) -> list:
    r = _row(user_id)
    return json.loads(r[1]) if r and r[1] else []


def put_fact(user_id: str, fact: dict) -> None:
    ensure_user(user_id)
    facts = get_facts(user_id)
    facts = [f for f in facts if f.get("key") != fact.get("key")]
    facts.insert(0, fact)
    with _cursor() as c:
        c.execute("UPDATE users SET facts=?, updated_at=? WHERE id=?",
                  (json.dumps(facts[:300]), int(__import__("time").time()), user_id))


def put_note(user_id: str, text: str) -> None:
    ensure_user(user_id)
    notes = get_notes(user_id)
    notes.insert(0, {"text": text[:2000], "ts": int(__import__("time").time())})
    with _cursor() as c:
        c.execute("UPDATE users SET notes=?, updated_at=? WHERE id=?",
                  (json.dumps(notes[:500]), int(__import__("time").time()), user_id))


def wipe(user_id: str) -> None:
    with _cursor() as c:
        c.execute("DELETE FROM users WHERE id=?", (user_id,))


def memory_brief(user_id: str) -> str:
    """Injected into the system prompt so the LLM answers like it knows you."""
    facts = get_facts(user_id)
    notes = get_notes(user_id)[:5]
    lines = []
    if facts:
        lines.append("Facts: " + "; ".join(f"{f.get('label','')}: {f.get('value','')}" for f in facts[:12]))
    if notes:
        lines.append("Notes: " + "; ".join(n["text"][:80] for n in notes))
    return "\n".join(lines)
