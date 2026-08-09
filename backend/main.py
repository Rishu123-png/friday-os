# FRIDAY OS — Backend server (FastAPI)
# Run:  uvicorn main:app --host 0.0.0.0 --port 8000   (from backend/)
# Docs: GET /docs
import json
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, StreamingResponse

from auth import require_token
from config import settings
from llm import run_tool_loop
from cloud_providers import provider_status
from memory import (get_facts, get_notes, memory_brief, put_fact, put_note, wipe)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # v1.1: optional Telegram bridge (talk to FRIDAY from Telegram)
    from telegram import start_bridge
    bridge = start_bridge()
    yield
    if bridge is not None and bridge._task is not None:
        bridge._task.cancel()


app = FastAPI(title="FRIDAY OS Backend", version=settings.VERSION,
              dependencies=[Depends(require_token)], lifespan=lifespan)

origins = ["*"] if settings.CORS_ORIGINS == "*" else [o.strip() for o in settings.CORS_ORIGINS.split(",")]
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["*"],
                   allow_headers=["*"])


# user id: from the token itself (stable per device), or a header override.
def user_id(request: Request) -> str:
    token = request.headers.get("authorization", "")
    return request.headers.get("x-user-id") or token or "default"


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
            "providers": cloud, "serverMode": True, "model": settings.GROQ_MODEL}


# ---------------- /v1/chat (SSE) ----------------
@app.post("/v1/chat")
async def chat(request: Request):
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    messages = body.get("messages")
    if not isinstance(messages, list) or not messages:
        raise HTTPException(status_code=400, detail="messages[] required")

    brief = memory_brief(user_id(request))

    async def event_stream():
        try:
            async for ev in run_tool_loop(messages, brief):
                yield f"data: {json.dumps(ev, ensure_ascii=False)}\n\n"
        except RuntimeError as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        except Exception as e:  # never kill the stream on a bug
            yield f"data: {json.dumps({'type': 'error', 'message': 'server: ' + str(e)[:200]})}\n\n"

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
