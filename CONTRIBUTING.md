# Contributing to FRIDAY OS

Thanks for wanting to help. This is an ambitious one-person project and contributions of every size are genuinely welcome — a typo fix is as valid as a new subsystem.

---

## Getting Started

```bash
git clone https://github.com/Rishu123-png/friday-os.git
cd friday-os
npm ci
npm test          # 358 tests — should be green before you change anything
```

To see the HUD running:

```bash
npm run serve     # → http://localhost:8080
```

The frontend boots fully offline with local engines — no API keys or backend needed. If you want to work on the backend too, see the Quickstart section of the [README](README.md).

**Native work** needs JDK 21 and Android SDK 35, and `tools/buildenv.sh` provisions an `android.jar` plus Capacitor stubs so you can compile-check Java without Android Studio:

```bash
bash tools/buildenv.sh
bash tools/javac-check.sh      # → JAVAC OK
```

---

## The One Rule

> **`npm test` must be green before you open a PR.**

The test suite is not decoration — it's the enforcement mechanism for the safety guarantees this project makes. A PR that turns the suite red will not be merged, however good the feature is.

```bash
npm test              # everything
npm run test:web      # 333 Node tests
npm run test:backend  # 25 Python tests
```

If you're **adding a feature**, add tests for it. If you're **fixing a bug**, add a regression test. If a test is genuinely wrong, explain why in the PR.

---

## Never Commit Secrets

Non-negotiable, and this project has been burned by it before:

- No API keys, tokens or passwords — in code, comments, test fixtures, config, or commit messages
- No `.env` files — `.env.example` only, with empty values
- No real personal data in fixtures — use `+919876543210` and `user@example.com` style placeholders
- No keystores, `.jks` files or signing material

Use obvious placeholders: `gsk_your_key_here`.

If you find a credential in the repo, please report it privately via [SECURITY.md](SECURITY.md) instead of opening a public issue.

---

## Working on the Device Protocol

This is the most sensitive part of the codebase. If you touch it:

1. Update **both** `protocol/action-v1.schema.json` **and** `backend/action_protocol.py`.
2. A test asserts they never drift — it will catch you if you only do one.
3. Assign a correct **safety tier**: `low` executes immediately, `medium` needs confirmation, `high` needs confirmation and validated dangerous arguments.
4. Never let a missing dangerous detail be guessed. Fail loudly.
5. Add tests for the new action and its validation edge cases.

```bash
python3 tools/generate_action_schema.py   # regenerates the schema
```

---

## Code Style

There's no linter enforcing style today — match the surrounding code and keep diffs focused.

**JavaScript**
- ES modules with explicit `.js` extensions in imports
- Prefer `const`/`let`; no `var`
- Keep the existing module boundaries — `store.js` for state, `api.js` for transport, `ui.js` for rendering
- Avoid adding to `app.js` where a module would do; the monolith split is an active goal

**Python**
- Type hints on function signatures
- `snake_case`, standard-library-first
- Fail loudly on invalid input; don't silently coerce
- New backend settings go in `config.py` and get documented in `.env.example`

**Java**
- Keep the `Friday*` class naming convention
- Every class should be reachable from a manifest entry or service — no orphans. `native/validate_android.py` enforces some of this at build time
- Verify with `tools/javac-check.sh` before pushing

**General**
- Comment *why*, not *what*
- Don't leave debug logging behind
- No new runtime dependencies without discussing it in an issue first — this project takes pride in a small dependency footprint

---

## Commit Messages

Conventional-commit style keeps history readable:

```
feat(voice): add barge-in for continuous listening mode
fix(protocol): reject SMS body that exceeds 1000 characters
docs(readme): document the MQTT bridge
test(memory): cover wipe across multiple users
refactor(hud): extract vite panel into its own module
```

Explain **why** in the body when the reason isn't obvious.

---

## Pull Requests

**Before opening:**
- [ ] `npm test` passes — 358/358
- [ ] New features have tests; bug fixes have regression tests
- [ ] No secrets, no real personal data
- [ ] Protocol changes updated schema **and** backend
- [ ] `README.md` updated if you changed setup, config or features
- [ ] Commit history is clean and readable

**In the PR description, tell me:**
- What problem this solves
- How you tested it
- Anything you're unsure about
- Screenshots or a short clip for UI changes

**Please keep PRs focused.** One logical change per PR. If you find an unrelated bug along the way, open a separate issue — small, reviewable PRs get merged far faster.

---

## Good First Issues

New here? These are genuinely tractable:

| Task | Where |
|---|---|
| Wire up or remove the 4 orphaned `modules/` controllers | `www/js/modules/`, `www/sw.js` |
| Continue splitting the `app.js` monolith | `www/js/app.js` |
| Add screenshots / a demo video | `README.md` |
| Improve i18n coverage | `www/js/i18n.js` |
| Add action-protocol edge-case tests | `tests/` |
| Write an `ARCHITECTURE.md` deep-dive | new file |

Look for the [`good first issue`](https://github.com/Rishu123-png/friday-os/labels/good%20first%20issue) label.

---

## Questions

Open a [Discussion](https://github.com/Rishu123-png/friday-os/discussions) for design questions and "how does this work" — issues are for actionable bugs and features. You can also open a draft PR early if you want feedback on an approach before finishing it.

---

## Code of Conduct

Participation is covered by the [Code of Conduct](CODE_OF_CONDUCT.md). Be decent to each other.

---

**Thank you for contributing.** ⭐
