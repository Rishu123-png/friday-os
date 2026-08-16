# FRIDAY OS — Backend server (FastAPI)
# Run:  uvicorn main:app --host 0.0.0.0 --port 8000   (from backend/)
# Docs: GET /docs
import hashlib
import json
import re
import tempfile
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response, StreamingResponse

from action_protocol import ACTION_DEFINITIONS, PROTOCOL_VERSION, ActionStore, ProtocolError
from auth import require_token
from config import settings
from llm import run_tool_loop
from device_commands import confirmation_reply, resolve_device_command
from cloud_providers import provider_status
from memory import (get_facts, get_notes, memory_brief, put_fact, put_note, wipe)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Fail before opening bridges or accepting traffic when production security
    # settings are incomplete.
    settings.validate_startup()
    app.state.action_store = ActionStore(
        settings.ACTION_DB_PATH, settings.ACTION_CLAIM_LEASE_SECONDS
    )
    from telegram import start_bridge
    bridge = start_bridge()
    try:
        yield
    finally:
        if bridge is not None and bridge._task is not None:
            bridge._task.cancel()
        app.state.action_store.close()


app = FastAPI(title="FRIDAY OS Backend", version=settings.VERSION,
              dependencies=[Depends(require_token)], lifespan=lifespan)

origins = ["*"] if settings.CORS_ORIGINS == "*" else [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"],
                   allow_headers=["Authorization", "Content-Type", "X-User-ID"])


_USER_HEADER_RE = re.compile(r"^[A-Za-z0-9._:@+-]{1,128}$")


def user_id(request: Request) -> str:
    """Return an opaque, server-derived database identity.

    Authorization headers and raw app-provided identifiers are never used as
    database keys. X-User-ID is rejected unless a trusted multi-user deployment
    explicitly opts in with ALLOW_USER_HEADER=true.
    """
    supplied_user = request.headers.get("x-user-id")
    if supplied_user:
        if not settings.ALLOW_USER_HEADER:
            raise HTTPException(status_code=400, detail="X-User-ID is not enabled")
        if not _USER_HEADER_RE.fullmatch(supplied_user):
            raise HTTPException(status_code=400, detail="Invalid X-User-ID")
        identity = "trusted-user:" + supplied_user
    else:
        identity = "token:" + (settings.FRIDAY_TOKEN or "isolated-local-development")
    return "usr_" + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:32]


@app.get("/health")
async def health():
    engines = {}
    try:
        import edge_tts  # noqa
        engines["tts"] = "edge-tts"
    except ImportError:
        engines["tts"] = "not-installed"
    try:
        import faster_whisper  # noqa
        engines["stt"] = "faster-whisper"
    except ImportError:
        engines["stt"] = "not-installed"
    try:
        import sentence_transformers  # noqa
        engines["embed"] = "sentence-transformers"
    except ImportError:
        engines["embed"] = "not-installed"
    cloud = provider_status()
    engines["llm"] = "configured" if any(v.get("configured") for v in cloud.values()) else "offline-only"
    return {"ok": True, "version": settings.VERSION, "engines": engines,
            "providers": cloud, "serverMode": True, "model": settings.GROQ_MODEL,
            "actionProtocol": PROTOCOL_VERSION}


# ---------------- Typed backend→device Action Protocol v1 ----------------
def _actions(request: Request) -> ActionStore:
    store = getattr(request.app.state, "action_store", None)
    if store is None:
        raise HTTPException(status_code=503, detail="Action queue is not ready")
    return store


def _protocol_http_error(error: ProtocolError) -> HTTPException:
    status = 409 if error.code in {
        "idempotency_conflict", "invalid_state", "lease_mismatch"
    } else 400
    return HTTPException(status_code=status, detail={"code": error.code, "message": str(error)})


@app.get("/v1/actions/capabilities")
async def action_capabilities():
    return {
        "protocol_version": PROTOCOL_VERSION,
        "actions": {
            name: {
                "required_capability": definition["capability"],
                "safety_level": definition["safety"],
                "confirmation_required": definition["confirm"],
            }
            for name, definition in ACTION_DEFINITIONS.items()
        },
    }


@app.post("/v1/actions", status_code=201)
async def enqueue_action(request: Request):
    try:
        body = await request.json()
        action, created = _actions(request).enqueue(user_id(request), body)
    except ProtocolError as error:
        raise _protocol_http_error(error)
    except Exception as error:
        if isinstance(error, HTTPException):
            raise
        raise HTTPException(status_code=400, detail="Invalid JSON body") from error
    return JSONResponse(status_code=201 if created else 200, content=action)


@app.post("/v1/actions/claim")
async def claim_action(request: Request):
    try:
        body = await request.json()
        if not isinstance(body, dict) or set(body) - {"protocol_version", "device_id", "capabilities"}:
            raise ProtocolError("claim has unknown fields")
        if body.get("protocol_version") != PROTOCOL_VERSION:
            raise ProtocolError(f"protocol_version must be {PROTOCOL_VERSION}", "unsupported_version")
        capabilities = body.get("capabilities")
        if (not isinstance(capabilities, list) or len(capabilities) > 100 or
                any(not isinstance(item, str) or len(item) > 64 for item in capabilities)):
            raise ProtocolError("capabilities must be a list of at most 100 short strings")
        action = _actions(request).claim(
            user_id(request), str(body.get("device_id") or ""), set(capabilities)
        )
    except ProtocolError as error:
        raise _protocol_http_error(error)
    if action is None:
        return Response(status_code=204)
    return action


@app.get("/v1/actions/{action_id}")
async def get_action(action_id: str, request: Request):
    action = _actions(request).get(user_id(request), action_id)
    if action is None:
        raise HTTPException(status_code=404, detail="Action not found")
    return action


@app.post("/v1/actions/{action_id}/confirm")
async def confirm_action(action_id: str, request: Request):
    try:
        action = _actions(request).confirm(user_id(request), action_id)
    except ProtocolError as error:
        raise _protocol_http_error(error)
    if action is None:
        raise HTTPException(status_code=404, detail="Action not found")
    return action


@app.post("/v1/actions/{action_id}/cancel")
async def cancel_action(action_id: str, request: Request):
    try:
        action = _actions(request).cancel(user_id(request), action_id)
    except ProtocolError as error:
        raise _protocol_http_error(error)
    if action is None:
        raise HTTPException(status_code=404, detail="Action not found")
    return action


@app.post("/v1/actions/{action_id}/result")
async def submit_action_result(action_id: str, request: Request):
    try:
        body = await request.json()
        action = _actions(request).submit_result(user_id(request), action_id, body)
    except ProtocolError as error:
        raise _protocol_http_error(error)
    if action is None:
        raise HTTPException(status_code=404, detail="Action not found")
    return action


# ---------------- /v1/chat (SSE) ----------------
_CHAT_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{8,128}$")
_CONFIRMABLE_STATES = {"awaiting_confirmation", "queued", "claimed"}


def _chat_action_text(action: dict, summary: str) -> str:
    if action["state"] == "awaiting_confirmation":
        return (
            f"I'm ready to {summary}, but this action needs your confirmation. "
            "Say yes to authorize it, or cancel. Nothing has run yet."
        )
    return (
        f"I queued the request to {summary} on your phone. It has not been reported "
        "as completed yet; the device will execute and verify it when available."
    )


def _terminal_action_text(action: dict) -> str:
    state = action.get("state")
    details = action.get("result", {}).get("verification", {}).get("detail")
    if state == "succeeded":
        return details or "The phone independently verified that action."
    if state == "unverified":
        return details or "The phone accepted the action, but could not independently verify the result."
    if state == "cancelled":
        return "That action is cancelled. Nothing else will run for it."
    return details or f"That action is already {state or 'unavailable'}."


def _validate_chat_messages(value) -> list[dict]:
    if not isinstance(value, list) or not value or len(value) > 50:
        raise HTTPException(status_code=400, detail="messages[] required (maximum 50)")
    clean = []
    total = 0
    for item in value:
        if not isinstance(item, dict) or set(item) - {"role", "content", "name"}:
            raise HTTPException(status_code=400, detail="Invalid chat message")
        role = item.get("role")
        content = item.get("content")
        if role not in {"user", "assistant", "system"} or not isinstance(content, str):
            raise HTTPException(status_code=400, detail="Invalid chat role or content")
        if len(content) > 12_000:
            raise HTTPException(status_code=400, detail="Chat message is too long")
        total += len(content)
        if total > 80_000:
            raise HTTPException(status_code=400, detail="Chat history is too large")
        clean.append({"role": role, "content": content})
    if not any(item["role"] == "user" for item in clean):
        raise HTTPException(status_code=400, detail="A user message is required")
    return clean


@app.post("/v1/chat")
async def chat(request: Request):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    if not isinstance(body, dict) or set(body) - {"messages", "chat_request_id", "pending_action_id"}:
        raise HTTPException(status_code=400, detail="Unknown chat fields")

    messages = _validate_chat_messages(body.get("messages"))
    request_id = str(body.get("chat_request_id") or uuid.uuid4())
    if not _CHAT_ID_RE.fullmatch(request_id):
        raise HTTPException(status_code=400, detail="Invalid chat_request_id")
    pending_action_id = str(body.get("pending_action_id") or "").strip()
    if pending_action_id and (len(pending_action_id) > 128 or not re.fullmatch(r"[A-Za-z0-9-]+", pending_action_id)):
        raise HTTPException(status_code=400, detail="Invalid pending_action_id")

    uid = user_id(request)
    brief = memory_brief(uid)
    latest_user = next(item["content"] for item in reversed(messages) if item["role"] == "user")
    store = _actions(request)
    action_index = 0

    async def enqueue_for_chat(command: dict) -> dict:
        nonlocal action_index
        action_index += 1
        action_type = command.get("type")
        args = command.get("args")
        summary = str(command.get("summary") or action_type or "run the requested action")[:180]
        action, _created = store.enqueue(uid, {
            "protocol_version": PROTOCOL_VERSION,
            "type": action_type,
            "args": args,
            "idempotency_key": f"chat-{request_id}-{action_index}",
            "expires_in_seconds": 300,
            "safety": {"confirmed": False},
        })
        return {"action": action, "summary": summary}

    async def one_reply(text: str, action_event: dict | None = None):
        if action_event is not None:
            yield {"type": "action", **action_event}
        # Keep the existing token SSE contract used by the Android web client.
        for chunk in text:
            yield {"type": "token", "text": chunk}
        yield {"type": "done"}

    async def event_stream():
        try:
            # Confirmation is bound to an authenticated, explicit action id;
            # a bare "yes" can never authorize some other queued action.
            answer = confirmation_reply(latest_user) if pending_action_id else None
            if answer:
                pending = store.get(uid, pending_action_id)
                if pending is None:
                    async for ev in one_reply("I couldn't find that pending action. Please ask me to create it again."):
                        yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
                    return
                if pending["state"] not in _CONFIRMABLE_STATES:
                    async for ev in one_reply(_terminal_action_text(pending), {"action": pending, "summary": "pending action"}):
                        yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
                    return
                if answer == "cancel" and pending["state"] == "claimed":
                    changed = pending
                    text = (
                        "The phone has already claimed that action, so I cannot guarantee cancellation now. "
                        "I will not pretend it was stopped; please check the reported result."
                    )
                elif answer == "cancel":
                    changed = store.cancel(uid, pending_action_id)
                    text = "Cancelled. The phone had not claimed it, so that action will not run."
                elif pending["state"] == "awaiting_confirmation":
                    changed = store.confirm(uid, pending_action_id)
                    text = _chat_action_text(changed, "run the action you confirmed")
                else:
                    changed = pending
                    text = "That action was already authorized and is waiting for the phone. It is not verified yet."
                async for ev in one_reply(text, {"action": changed, "summary": "confirmed phone action"}):
                    yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
                return

            # Common commands are deterministic and remain available even when
            # the cloud LLM is down. The queue still performs canonical schema,
            # safety, and idempotency validation.
            direct = resolve_device_command(latest_user)
            if direct is not None:
                action_event = await enqueue_for_chat(direct)
                text = _chat_action_text(action_event["action"], action_event["summary"])
                async for ev in one_reply(text, action_event):
                    yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
                return

            async for ev in run_tool_loop(messages, brief, enqueue_for_chat):
                yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
        except ProtocolError as error:
            ev = {"type": "error", "message": f"Action rejected: {str(error)[:180]}"}
            yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
        except RuntimeError as error:
            yield f"data: {json.dumps({'type': 'error', 'message': str(error)})}\n\n"
        except Exception as error:  # never kill the stream on a bug
            yield f"data: {json.dumps({'type': 'error', 'message': 'server: ' + str(error)[:200]})}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------------- /v1/stt ----------------
@app.post("/v1/stt")
async def stt(file: UploadFile = File(...)):
    data = await file.read()
    if len(data) > settings.MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Audio too large")
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as tmp:
        tmp.write(data)
        path = tmp.name
    try:
        from stt import transcribe_file
        return transcribe_file(path, settings.STT_MODEL)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    finally:
        Path(path).unlink(missing_ok=True)


# ---------------- /v1/tts ----------------
@app.post("/v1/tts")
async def tts(request: Request):
    body = await request.json()
    text = str(body.get("text") or "").strip()
    voice = body.get("voice") or None
    if not text:
        raise HTTPException(status_code=400, detail="text required")
    try:
        from tts import synthesize
        audio = await synthesize(text, voice)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    with tempfile.NamedTemporaryFile(suffix=".mp3", delete=False) as tmp:
        tmp.write(audio)
        path = tmp.name
    return FileResponse(path, media_type="audio/mpeg", headers={
        "Content-Disposition": "inline; filename=friday.mp3",
        "X-Friday-Delete": path})  # client can ignore; server cleans on next call


# ---------------- /v1/web (server-side fetch; replaces flaky public proxies) ----------------
@app.post("/v1/web")
async def web_fetch(request: Request):
    body = await request.json()
    url = str(body.get("url") or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="url required")
    from tools import fetch_raw
    text = await fetch_raw({"url": url})
    return {"ok": not text.startswith("Fetch failed"), "text": text}


# ---------------- /dashboard (web console) ----------------
@app.get("/dashboard", response_class=HTMLResponse, include_in_schema=False)
async def dashboard():
    page = Path(__file__).parent / "static" / "dashboard.html"
    if not page.exists():
        raise HTTPException(status_code=404, detail="dashboard not shipped in this copy")
    return HTMLResponse(page.read_text(encoding="utf-8"))


# ---------------- /v1/vision (describe a shared/captured image) ----------------
@app.post("/v1/vision")
async def vision(request: Request):
    body = await request.json()
    image = str(body.get("image_b64") or body.get("image") or "").strip()
    question = str(body.get("question") or "").strip()
    if not image:
        raise HTTPException(status_code=400, detail="image_b64 required")
    if len(image) > 26_000_000:   # ~19MB of image bytes
        raise HTTPException(status_code=413, detail="image too large")
    try:
        from vision import describe_image
        text = await describe_image(image, question)
        return {"ok": True, "text": text}
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


# ---------------- /v1/embed ----------------
@app.post("/v1/embed")
async def embed(request: Request):
    body = await request.json()
    texts = body.get("texts")
    if not isinstance(texts, list) or not texts:
        raise HTTPException(status_code=400, detail="texts[] required")
    try:
        from embed import embed_texts
        return {"vectors": embed_texts([str(t) for t in texts], settings.EMBED_MODEL)}
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))


# ---------------- /v1/memory ----------------
@app.get("/v1/memory")
async def read_memory(request: Request):
    uid = user_id(request)
    return {"facts": get_facts(uid), "notes": get_notes(uid)}


@app.post("/v1/memory/fact")
async def add_fact(request: Request):
    body = await request.json()
    key = str(body.get("key") or "").strip()
    value = str(body.get("value") or "").strip()
    if not key or not value:
        raise HTTPException(status_code=400, detail="key and value required")
    put_fact(user_id(request), {"key": key, "label": body.get("label") or key,
                                "value": value, "ts": int(__import__("time").time())})
    return {"ok": True}


@app.post("/v1/memory/note")
async def add_note(request: Request):
    body = await request.json()
    text = str(body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text required")
    put_note(user_id(request), text)
    return {"ok": True}


@app.delete("/v1/memory")
async def wipe_memory(request: Request):
    wipe(user_id(request))
    return {"ok": True}


@app.delete("/v1/memory/fact")
async def delete_fact(request: Request, key: str):
    uid = user_id(request)
    facts = get_facts(uid)
    rest = [f for f in facts if f.get("key") != key]
    if len(rest) != len(facts):
        from memory import _cursor
        import json, time
        with _cursor() as c:
            c.execute("UPDATE users SET facts=?, updated_at=? WHERE id=?",
                      (json.dumps(rest), int(time.time()), uid))
    return {"ok": True}


# tiny cleanup for the TTS temp file
_prev_tts_path = {"p": None}


@app.middleware("http")
async def cleanup_tts(request: Request, call_next):
    response = await call_next(request)
    prev = _prev_tts_path["p"]
    if prev:
        try:
            Path(prev).unlink(missing_ok=True)
        except Exception:
            pass
        _prev_tts_path["p"] = None
    if request.url.path == "/v1/tts" and response.headers.get("X-Friday-Delete"):
        _prev_tts_path["p"] = response.headers["X-Friday-Delete"]
    return response
