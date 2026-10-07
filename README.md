<div align="center">

<img src="docs/social-preview.png" alt="FRIDAY OS — Personal AI Operating System" width="100%" />

<br/><br/>

# FRIDAY OS

### Your personal AI operating system — offline-first, privacy-first, built to actually *do* things.

**Not a chatbot in a box. An assistant that runs on your hardware, remembers you, and controls your device.**

<br/>

[![CI](https://github.com/Rishu123-png/friday-os/actions/workflows/ci.yml/badge.svg)](https://github.com/Rishu123-png/friday-os/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-00d4ff?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Android%20·%20PWA-3ddc84?style=flat-square)](#-platforms)
[![Python](https://img.shields.io/badge/python-3.12-3776ab?style=flat-square)](#-quickstart)
[![Offline First](https://img.shields.io/badge/offline--first-188%20skills-8b5cf6?style=flat-square)](#-design-principles)
[![Java](https://img.shields.io/badge/native-Java%2021-ed8b00?style=flat-square)](#-architecture)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-ff69b4?style=flat-square)](CONTRIBUTING.md)

<br/>

[Design Principles](#-design-principles) · [Screenshots](#-screenshots) · [Features](#-features) · [Architecture](#-architecture) · [Quickstart](#-quickstart) · [The Action Protocol](#-the-action-protocol) · [Security](#-security-model) · [Testing](#-testing)

</div>

---

## 🤔 What is FRIDAY OS?

FRIDAY OS is a **personal AI assistant that owns your device and your data**.

Most assistants are a text box that talks. FRIDAY OS is a full stack — a sci-fi HUD frontend, a native Android layer with real system privileges, and a self-hostable backend — wired together so that *"turn my torch on"* actually turns the torch on, *"remind me at 6"* actually schedules the alarm, and *"what do you remember about me"* answers from a memory store that lives on **your** machine.

It is **offline-first by design**. Every heavy capability — speech recognition, speech synthesis, wake word, embeddings, even a local LLM via llama.cpp — has an on-device path. Cloud providers are **optional accelerants**, not dependencies. Pull your network cable and it still works.

And because an assistant with system privileges is a serious thing, the whole device-control surface is a **typed, versioned, safety-tiered protocol** with confirmations, leases and honest status reporting — not a pile of shell commands glued to an LLM.

> **188 offline skills. 650 commits. 43,000+ lines of code. Built by one person, in public.**

---

## 📸 Screenshots

<div align="center">

<table>
<tr>
<td align="center" width="25%">
<img src="docs/screenshots/01-boot-sequence.webp" width="200" /><br/>
<sub><b>Cinematic boot</b><br/>Real service handshake</sub>
</td>
<td align="center" width="25%">
<img src="docs/screenshots/02-hud-dashboard.webp" width="200" /><br/>
<sub><b>The HUD</b><br/>Reactor + live telemetry</sub>
</td>
<td align="center" width="25%">
<img src="docs/screenshots/03-hud-degraded.webp" width="200" /><br/>
<sub><b>Honest failure</b><br/>States its own faults</sub>
</td>
<td align="center" width="25%">
<img src="docs/screenshots/04-activity-routines.webp" width="200" /><br/>
<sub><b>Activity</b><br/>Alarms, routines, places</sub>
</td>
</tr>
<tr>
<td align="center" width="25%">
<img src="docs/screenshots/05-brain-offline.webp" width="200" /><br/>
<sub><b>Brain</b><br/>Offline engine, cloud optional</sub>
</td>
<td align="center" width="25%">
<img src="docs/screenshots/06-voice-engine.webp" width="200" /><br/>
<sub><b>Voice engine 2.0</b><br/>Formal state machine</sub>
</td>
<td align="center" width="25%">
<img src="docs/screenshots/07-call-assistant.webp" width="200" /><br/>
<sub><b>Call Assistant</b><br/>Accept · Decline · Message</sub>
</td>
<td align="center" width="25%">
<img src="docs/screenshots/08-security-privacy.webp" width="200" /><br/>
<sub><b>Security</b><br/>App lock, consent, audit</sub>
</td>
</tr>
</table>

</div>

---

## 🧭 Design Principles

These are the rules the codebase actually follows. They explain most of the architectural decisions you'll see.

| Principle | What it means in practice |
|---|---|
| **🛜 Offline-first, not offline-only** | Local engines are the default path. Cloud is opt-in and degrades gracefully. A missing API key means *fewer features*, never a broken app. |
| **🔐 Fail-closed security** | A missing server token raises `503` — it never silently becomes an open API. Unsafe production config refuses to boot. Deny is the default state. |
| **🧠 The device is the frontier** | The backend is stateless glue. Real capability lives in the native layer, where the permissions and the sensors are. |
| **✍️ Typed actions, never free-form commands** | The LLM can pick *which* of 15 vetted actions to run. It cannot invent a 16th, cannot guess a phone number, cannot skip a confirmation. |
| **🤝 Honest status** | The UI never claims an action succeeded because it was *queued*. States are `queued → claimed → verified / failed / denied / unsupported`, and "unverified" is a real, displayed outcome. |
| **🔒 Your data stays yours** | No telemetry. No analytics. No phone-home. Memory lives in a SQLite file you own and can wipe with one endpoint. |
| **📦 Self-hostable, no lock-in** | One `docker run` and you have your own backend. Bring your own keys, your own model, your own server. |

> The **"Honest failure"** screenshot above is the clearest example. When voice breaks, the UI doesn't hide it — the reactor turns red, the status reads `Fault`, and the status bar says exactly what's wrong. Most apps would show a spinner forever.

---

## ⚡ Features

### 🖥️ The HUD
A living, cinematic interface — not a chat window with a skin.

- **Cinematic boot sequence** — real per-service check across 11 subsystems (core, bridge, memory, voice, wake word, vision, local AI, Groq, Blackbox, automation, HUD), tap-to-skip
- **Reactor core visualiser** with live telemetry — location, weather, network, Bluetooth
- **Localised status pings** — the assistant speaks your language, not just English
- **Self-hosted fonts** — Orbitron, Rajdhani, JetBrains Mono (76 KB, zero CDN calls)
- **Cinematic mode** — holographic glow, radar, scanlines; auto-honours reduced-motion
- **Installable PWA** with app shortcuts and a resilient service worker

### 🎙️ Voice Engine 2.0
- **Formal state machine** — `OFFLINE → READY → LISTENING → UNDERSTANDING → THINKING → EXECUTING → SPEAKING`. The orb, feed and status line follow real state; no fake animation
- **Custom wake words** — comma-separated, with a bundled Vosk wake brain (~36 MB, offline forever)
- **Adjustable barge-in sensitivity** — interrupt it as easily as you like
- **On-device STT** — Vosk + Sherpa-ONNX, no audio leaves the phone
- **Neural TTS** — human-like voice, with Android TTS fallback
- **Streaming voice** — speaks while thinking, hands-free auto-mic conversation

### 🧠 Memory & Cognition
- **Memory Dashboard** — daily conversation digests generated locally
- Facts, notes and semantic recall backed by SQLite; pinned memories are never auto-deleted
- Embedding-based retrieval (`sentence-transformers/all-MiniLM-L6-v2`, or on-device)
- A compact **memory brief** injected into every prompt, so it knows you across sessions
- Full wipe — `DELETE /v1/memory` — because it's your data

### 📱 Real Device Control
15 typed actions across three safety tiers — torch, volume, brightness, WiFi, Bluetooth, media, app launch, alarms, battery, storage, notifications, screen reading, screenshots, phone calls and SMS.

### 📞 Call Assistant
- Announces the caller with **Accept · Decline · Silence · Decline + message**
- Previews the exact recipient and message text before anything sends
- Configurable SMS / notification send path
- Honest boundaries: **cannot** intercept cellular audio or inject an AI voice into a call

### 📥 FRIDAY Inbox
- Reads your notifications and **drafts** replies from your own memory
- **Sends only after you say so** — nothing goes out without your explicit word
- Smart categories (Messages, Email, Calendar), per-package and per-sender mute lists
- Rate limited: minimum gap and hourly cap

### 🛡️ Security & Privacy
- **App lock** — PIN, never stored in plaintext
- **Cloud AI consent** — cloud only runs when you explicitly allow it
- **Audit trail** — permissions, automation and security events, locally recorded
- **Keystore-backed key storage** — Groq keys are encrypted with Android Keystore, never exported, never prefilled in source
- **Emergency SOS** — say "SOS" and it SMSes your live location after an 8-second cancel window
- **Quiet hours**, private mode, and "keep details private while locked"

### 🛠️ Beyond the Basics
| | |
|---|---|
| **Agent orchestrator** | Multi-step decomposition with a verification pass |
| **Airrouter** | Provider routing and failover across local + cloud models |
| **Health** | Health Connect — steps, heart rate, sleep |
| **Vault** | On-device encrypted storage for secrets |
| **Coder** | Code generation with a built-in dev console |
| **Vision** | Camera + screen understanding, cloud or local |
| **Automation** | Event-driven rules — battery guard, headphone resume, offline comfort. Risky actions still confirm |
| **Geofencing** | Location-aware triggers ("remind me when I get home") |
| **Guardian** | Security auditing, phishing/URL analysis |
| **Performance** | FPS / CPU / RAM / AI latency monitor, battery gate, response cache |
| **Bridges** | Optional **Telegram** and **MQTT** — talk to your assistant from anywhere, or wire it into your smart home |

---

## 🏗️ Architecture

```
                          ┌─────────────────────────────────┐
                          │   FRIDAY OS HUD  (www/)         │
                          │   Vanilla ES modules · PWA      │
                          │   Service worker · Offline-first│
                          └────────────┬────────────────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              │                        │                        │
              ▼                        ▼                        ▼
   ┌──────────────────┐   ┌────────────────────┐   ┌────────────────────┐
   │ LOCAL ENGINES    │   │  CAPACITOR BRIDGE  │   │  BACKEND (opt.)    │
   │                  │   │      www/js/native  │   │      FastAPI       │
   │ · llama.cpp      │   │         .js         │   │                    │
   │ · Vosk / Sherpa  │   │          │          │   │  /v1/chat  /v1/stt │
   │ · Wake word      │   │          ▼          │   │  /v1/tts   /v1/web │
   │ · Embeddings     │   │  ┌───────────────┐  │   │  /v1/memory  ...   │
   │ · 188 skills     │   │  │ NATIVE JAVA   │  │   │                    │
   └──────────────────┘   │  │  14,600 LOC   │  │   │  SQLite action     │
                          │  │  29 classes   │  │   │  queue + leases    │
                          │  └───────┬───────┘  │   └─────────┬──────────┘
                          │          │          │             │
                          └──────────┼──────────┘             │
                                     │                        │
                          ┌──────────▼──────────┐   ┌─────────▼──────────┐
                          │  ANDROID SYSTEM     │   │  OPTIONAL CLOUD    │
                          │  Torch · Volume     │   │  · Groq            │
                          │  WiFi · BT · SMS    │   │  · Blackbox        │
                          │  Alarms · Sensors   │   │  (keys stay        │
                          │  Health Connect     │   │   server-side)     │
                          └─────────────────────┘   └────────────────────┘
```

### Repository layout

| Path | What's inside |
|---|---|
| **`www/`** | The entire frontend — `index.html`, 67 ES modules, HUD CSS, self-hosted fonts, service worker, manifest. **25,100+ lines.** |
| **`native/`** | 29 Java classes for the Android layer, plus `res/`, ProGuard rules, the vendored sherpa-onnx API and the build-time injection scripts. **14,600+ lines.** |
| **`backend/`** | FastAPI server — chat, STT, TTS, vision, embeddings, memory and the action queue. **3,000+ lines.** |
| **`protocol/`** | `action-v1.schema.json` — the single source of truth for the device protocol, kept in sync with the backend by a test. |
| **`tests/`** | 13 Node suites — HUD contracts, boot runtime, action protocol, proactive assistant, stress tests. |
| **`tools/`** | `buildenv.sh` (provisions android.jar + Capacitor stubs for offline `javac`), schema generator, Java compile checker. |
| **`docs/`** | Screenshots, hero and social-preview images. |
| **`codemagic.yaml`** | CI/CD — two workflows producing debug and signed-release APKs. |

### Why is `native/` Java files and not an `android/` project?

The Gradle project is **generated at build time**, not committed. The pipeline runs `npx cap add android`, then the Python scripts in `native/` patch the generated project:

- `register_plugin.py` — wires `FridayNative.java` into the Capacitor plugin registry
- `patch_manifest.py` — injects permissions, services and receivers into `AndroidManifest.xml`
- `add_llama_dep.py` / `add_sherpa_dep.py` — add the llama.cpp and sherpa-onnx dependencies
- `configure_release.py` — applies signing and release hardening
- `validate_android.py` — **fail-fast gate** that aborts the build if any injection didn't land

This keeps the repo small, the diff clean, and makes the native layer reproducible from source.

---

## 🚀 Quickstart

### Prerequisites
- **Node 20+** and **Python 3.12+** for the web app and backend
- **JDK 21 + Android SDK 35** only if you're building the APK

### 1 · Run the HUD

```bash
git clone https://github.com/Rishu123-png/friday-os.git
cd friday-os
npm run serve          # → http://localhost:8080
```

That's it. The HUD boots fully offline with 188 local skills. No keys, no backend, no account.

### 2 · Run the backend (optional — unlocks cloud models & sync)

```bash
cd backend
pip install -r requirements.txt

cp ../.env.example .env
python3 -c "import secrets; print(secrets.token_hex(32))"   # → paste into FRIDAY_TOKEN

uvicorn main:app --host 0.0.0.0 --port 8000
```

Interactive API docs at **`http://localhost:8000/docs`**, live action dashboard at **`/dashboard`**.

Or with Docker:

```bash
docker build -f backend/Dockerfile -t friday-backend .
docker run -d -p 8000:8000 --env-file backend/.env friday-backend
```

### 3 · Build the Android app

```bash
npm ci
npx cap add android
npx cap sync android
cd android && ./gradlew assembleDebug     # → android/app/build/outputs/apk/debug/
```

Or push to `main` — **Codemagic builds a debug APK automatically.**

### Optional heavy engines

The light core boots with five dependencies. Add these to `requirements.txt` when you want more:

| Package | Unlocks | Weight |
|---|---|---|
| `edge-tts` | Neural TTS voices | light, needs net |
| `faster-whisper` | Server-side STT | ~2 GB |
| `sentence-transformers` | Server-side embeddings | ~500 MB |
| `paho-mqtt` | Smart-home bridge | light |

---

## 🔌 The Action Protocol

This is the most interesting part of the codebase, and the reason an LLM is allowed anywhere near your device.

**`protocol/action-v1.schema.json`** defines exactly **15 device actions**. Each one declares typed arguments, a safety tier, and whether it requires confirmation. A test asserts the schema and the backend's `ACTION_DEFINITIONS` never drift apart.

### The three safety tiers

| Tier | Actions | Behaviour |
|---|---|---|
| 🟢 **Low** | `torch`, `volume`, `brightness`, `wifi`, `bluetooth`, `media`, `apps`, `alarms`, `battery`, `storage` | Executes immediately |
| 🟡 **Medium** | `notifications`, `screen_read`, `screenshot` | Requires explicit confirmation — these expose your data |
| 🔴 **High** | `phone`, `sms` | Requires confirmation **and** an exact, validated phone number |

### How a request flows

```
  "call Mom"
      │
      ▼
  ┌──────────────────────────────┐
  │ LLM proposes an action       │   ← it may only choose from the 15
  │ {type: "phone",              │
  │  args: {number: "..."}}      │
  └──────────────┬───────────────┘
                 ▼
  ┌──────────────────────────────┐
  │ Validation                   │   ← typed args, ranges, enums, E.164
  │                              │     a missing number is NEVER guessed
  └──────────────┬───────────────┘
                 ▼
  ┌──────────────────────────────┐
  │ Enqueue (201)                │   ← idempotent: same request id
  │ → state: queued              │     returns the same action id
  └──────────────┬───────────────┘
                 ▼
  ┌──────────────────────────────┐
  │ Confirmation (high tier)     │   ← a bare "yes" is NOT acceptable;
  │                              │     the exact pending action id is
  └──────────────┬───────────────┘     required, and bound to the owner
                 ▼
  ┌──────────────────────────────┐
  │ Device claims + executes     │   ← bounded lease (default 90 s),
  │ → verified / failed /        │     lease retries are strictly limited
  │   denied / unsupported       │
  └──────────────────────────────┘
```

### Guarantees the tests enforce

- **No invented actions** — exactly 15 are covered; the LLM's tool list is normalised against them.
- **No guessed dangerous details** — a missing phone number or SMS body fails loudly rather than being improvised.
- **No confirmation by accident** — "yes" alone cannot confirm; the exact pending id must be supplied, and it is bound to the owning user.
- **No false success** — a queued action never reports as completed, and unavailable verification reports `unverified`, not `done`.
- **No revival of expired actions** — and cancellation of an already-claimed action is never falsely guaranteed.
- **Idempotent everywhere** — retries reuse the id and reject conflicting payloads; an aborted chat is never silently retried.

### API surface

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/health` | Liveness + provider status |
| `GET` | `/v1/actions/capabilities` | What this device can do |
| `POST` | `/v1/actions` | Enqueue an action |
| `POST` | `/v1/actions/claim` | Device claims work (rate-limited, 10/min) |
| `GET` | `/v1/actions/{id}` | Poll state |
| `POST` | `/v1/actions/{id}/confirm` | Confirm |
| `POST` | `/v1/actions/{id}/cancel` | Cancel |
| `POST` | `/v1/actions/{id}/result` | Report verified outcome |
| `POST` | `/v1/chat` | Conversational turn with tool loop |
| `POST` | `/v1/stt` · `/v1/tts` | Speech in / speech out |
| `POST` | `/v1/vision` · `/v1/web` · `/v1/embed` | Vision, fetching, embeddings |
| `GET/POST/DELETE` | `/v1/memory[/fact\|/note]` | Memory management |
| `GET` | `/dashboard` | Live operations view |

Every route requires `Authorization: Bearer <FRIDAY_TOKEN>`.

---

## 🔐 Security Model

An assistant that can read your screen and send SMS deserves scrutiny. Here's how it's contained.

**Authentication is mandatory and fail-closed.**
```python
if not expected:
    if settings.FRIDAY_ALLOW_INSECURE_LOCAL:
        return                      # explicit, opt-in, development only
    raise HTTPException(503, "Server authentication is not configured")
```
No token configured means **the server refuses to serve** — it does not fall back to open access. Comparison uses `hmac.compare_digest`, so there's no timing oracle.

**Identity is server-derived, never client-supplied.**
Your database key is `sha256(identity)[:32]`. The `X-User-ID` header is **rejected by default** and only honoured when a trusted multi-user deployment sets `ALLOW_USER_HEADER=true`.

**Keys live in Android Keystore.** Groq keys entered on-device are encrypted with Keystore, never shown again, never included in data exports, and never prefilled in the source or APK.


**Diagnostics redact themselves.** `FridayDiagnostics.java` scrubs anything matching `gsk_…` / `sk-…` before an export, so support bundles are safe to share.

**Startup refuses unsafe config.** `settings.validate_startup()` runs before the server accepts a single request.

**CORS is allowlisted** — `http://localhost,capacitor://localhost` by default, not `*`.

> 🔎 **Found a vulnerability?** Please open a [private security advisory](https://github.com/Rishu123-png/friday-os/security/advisories/new) rather than a public issue. See [SECURITY.md](SECURITY.md).

---

## 🧪 Testing

```bash
npm test             # everything
npm run test:web     # Node test suites
npm run test:backend # Python test suites
```

The suite is not decorative — it's the enforcement mechanism for the guarantees above. It covers the action protocol end-to-end, confirmation binding, lease expiry, idempotency, boot runtime, HUD contracts, provider failover, proactive behaviour, offline asset integrity and a stress pass.

There's also `tools/javac-check.sh`, which compile-checks all 29 native classes against `android.jar` plus Capacitor stubs — **no Android Studio required**. Run `tools/buildenv.sh` once to provision the jar and stubs.

---

## 📁 Configuration

All backend config lives in `backend/.env` (gitignored). Copy `.env.example` to start.

| Variable | Default | Notes |
|---|---|---|
| `FRIDAY_TOKEN` | — | **Required.** `openssl rand -hex 32` |
| `FRIDAY_ALLOW_INSECURE_LOCAL` | `false` | Dev-only escape hatch |
| `GROQ_API_KEY` | — | Optional. Primary cloud brain |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | |
| `GROQ_VISION_MODEL` | `meta-llama/llama-4-scout-17b-16e-instruct` | |
| `BLACKBOX_ENABLED` | `false` | Off unless you attest free access |
| `DB_PATH` | `./friday.db` | Memory store |
| `ACTION_DB_PATH` | `./action_queue.db` | Action queue |
| `ACTION_CLAIM_LEASE_SECONDS` | `90` | Lease window |
| `MAX_AUDIO_BYTES` | `25000000` | Upload cap |
| `STT_MODEL` | `small` | Whisper size |
| `TTS_VOICE` | `en-IN-NeerjaNeural` | |
| `EMBED_MODEL` | `sentence-transformers/all-MiniLM-L6-v2` | |
| `CORS_ORIGINS` | `http://localhost,capacitor://localhost` | Comma-separated |
| `ALLOW_USER_HEADER` | `false` | Multi-user only |
| `TELEGRAM_BOT_TOKEN` | — | Optional bridge |
| `MQTT_HOST` / `_PORT` / `_USER` / `_PASS` | — | Optional smart-home bridge |

> ⚠️ **Never commit `backend/.env`.** It is gitignored — keep it that way. If a key ever touches a commit, rotate it immediately; deleting the file does **not** remove it from history.

---
## 📱 Platforms

| Platform | Status |
|---|---|
| **Android** | Primary target — full native layer via Capacitor 7 |
| **PWA / Browser** | Full HUD; device actions degrade to web APIs |
| **Desktop** | The HUD runs in any browser via `npm run serve` |
| **iOS** | Not yet — the native layer is Android-specific |

---

## 🗺️ Roadmap

- [x] Screenshots in the README
- [ ] Finish splitting the 7,244-line `app.js` monolith into the `modules/` controllers
- [ ] Wire the 4 abandoned `modules/` controllers into the boot path (or delete them)
- [ ] Onboarding flow for first-run key setup
- [ ] iOS exploration via a Capacitor Swift shim
- [ ] Plugin registry SDK for third-party actions
- [ ] Expand the action protocol beyond 15

---
## 🤝 Contributing

Contributions are genuinely welcome — this is a large, ambitious codebase and there's plenty of room.

```bash
git clone https://github.com/Rishu123-png/friday-os.git
cd friday-os && npm ci
npm test              # must stay green
```

**Before you open a PR:**
1. `npm test` passes.
2. Anything touching the device protocol updates `protocol/action-v1.schema.json` **and** `backend/action_protocol.py` (a test will catch you if you forget).
3. **No new secrets.** Not in code, not in comments, not in tests, not in commit messages, and not "temporarily".
4. New user-facing strings respect the existing i18n module.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for community expectations.

**Great first issues:** the `modules/` split, i18n coverage, and new action-protocol tests.

---
## 📜 License

[MIT](LICENSE) — use it, fork it, ship it.

---

<div align="center">

### ⭐ If FRIDAY OS is interesting to you, a star genuinely helps. It's a one-person project.

**Built offline-first. Built private-first. Built to actually work.**

<sub>Named after FRIDAY — *Female Replacement Intelligent Digital Assistant Youth*.</sub>

</div>
