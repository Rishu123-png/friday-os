# FRIDAY OS — Telegram bridge (v1.1)
# Lets you talk to FRIDAY from Telegram: text or voice notes.
# Start it by setting TELEGRAM_BOT_TOKEN (+ TELEGRAM_ALLOWED_IDS) in .env —
# the server then polls the Bot API and forwards messages to the same
# /v1/chat brain, so your phone app and Telegram share one FRIDAY.
#
# Commands: /help  /memory  /forget  (plus normal chat)
import asyncio
import logging

import httpx

from config import settings
from llm import run_tool_loop
from memory import get_facts, memory_brief, wipe

log = logging.getLogger("friday.telegram")
API = "https://api.telegram.org/bot{token}/{method}"

MOTD = (
    "🤖 FRIDAY online. Message me anything — I share the same brain and "
    "memory as your phone app.\n\n"
    "/memory — what I know about you\n"
    "/forget — wipe my memory of you\n"
    "You can also send a *voice note* and I'll transcribe it."
)


class TelegramBridge:
    def __init__(self, token: str):
        self.token = token
        self.offset = 0
        self.allowed = {int(x) for x in settings.TELEGRAM_ALLOWED_IDS.split(",") if x.strip().isdigit()}
        self._task: asyncio.Task | None = None

    async def _call(self, method: str, **params) -> dict:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0)) as c:
            r = await c.post(API.format(token=self.token, method=method), json=params)
            if r.status_code == 401:
                log.error("Telegram: bad bot token")
                return {}
            return r.json() if r.status_code == 200 else {}

    async def send(self, chat_id: int, text: str) -> None:
        if not text:
            return
        for chunk in [text[i:i + 3800] for i in range(0, len(text), 3800)]:
            await self._call("sendMessage", chat_id=chat_id, text=chunk,
                             parse_mode="HTML" if "<" not in chunk else "")

    async def _voice_to_text(self, file_id: str) -> str | None:
        """Download a Telegram voice note and transcribe it (needs faster-whisper)."""
        try:
            from stt import transcribe_file
            import tempfile
            from pathlib import Path
            f = await self._call("getFile", file_id=file_id)
            fpath = f.get("result", {}).get("file_path")
            if not fpath:
                return None
            url = f"https://api.telegram.org/file/bot{self.token}/{fpath}"
            async with httpx.AsyncClient(timeout=httpx.Timeout(60.0)) as c:
                r = await c.get(url)
                if r.status_code != 200:
                    return None
            with tempfile.NamedTemporaryFile(suffix=".ogg", delete=False) as tmp:
                tmp.write(r.content)
                p = tmp.name
            try:
                out = transcribe_file(p, settings.STT_MODEL)
                return out.get("text") or None
            finally:
                Path(p).unlink(missing_ok=True)
        except Exception as e:
            log.warning("voice transcription failed: %s", e)
            return None

    async def _answer(self, chat_id: int, text: str | None, voice_file_id: str | None) -> None:
        uid = str(chat_id)
        if voice_file_id:
            text = await self._voice_to_text(voice_file_id)
            if not text:
                await self.send(chat_id, "I couldn't hear that — send it as text, or add STT on the server (pip install faster-whisper).")
                return
        text = (text or "").strip()
        if not text:
            return
        low = text.lower()
        if low in ("/help", "help", "kya kar sakte ho"):
            await self.send(chat_id, MOTD)
            return
        if low in ("/memory", "memory", "kya jaante ho"):
            facts = get_facts(uid)
            await self.send(chat_id,
                "What I know about you:\n" + "\n".join(f"- {f.get('label','')}: {f.get('value','')}" for f in facts[:20])
                if facts else "Nothing yet — tell me things like 'my name is Rishu'.")
            return
        if low in ("/forget", "forget", "sab bhool jao"):
            wipe(uid)
            await self.send(chat_id, "Done — memory wiped.")
            return
        # normal chat → same brain as the phone app
        brief = memory_brief(uid)
        messages = [{"role": "user", "content": text}]
        full = ""
        try:
            async for ev in run_tool_loop(messages, brief):
                if ev.get("type") == "token":
                    full += ev["text"]
        except Exception as e:
            full = f"Error: {e}"
        await self.send(chat_id, full.strip() or "(no reply)")

    async def poll_forever(self) -> None:
        log.info("Telegram bridge started (allowed IDs: %s)", self.allowed or "everyone")
        while True:
            try:
                data = await self._call("getUpdates", offset=self.offset, timeout=25)
                for upd in data.get("result", []):
                    self.offset = upd["update_id"] + 1
                    msg = upd.get("message") or upd.get("edited_message") or {}
                    chat_id = msg.get("chat", {}).get("id")
                    if chat_id is None:
                        continue
                    if self.allowed and chat_id not in self.allowed:
                        continue
                    text = msg.get("text")
                    voice = (msg.get("voice") or {}).get("file_id")
                    if text or voice:
                        asyncio.create_task(self._answer(chat_id, text, voice))
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log.warning("poll error: %s", e)
            await asyncio.sleep(1.5)

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self.poll_forever())


def start_bridge() -> TelegramBridge | None:
    if not settings.TELEGRAM_BOT_TOKEN:
        return None
    bridge = TelegramBridge(settings.TELEGRAM_BOT_TOKEN)
    bridge.start()
    return bridge
