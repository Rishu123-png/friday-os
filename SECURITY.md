# Security Policy

FRIDAY OS is an assistant with deep device access — it can read the screen, send SMS, place calls and control radios. Security is treated as a first-class concern, not an afterthought. This document explains how to report issues and what to expect.

---

## Reporting a Vulnerability

**Please do not open a public issue for security problems.**

Use GitHub's private advisory channel:

👉 **[Open a private security advisory](https://github.com/Rishu123-png/friday-os/security/advisories/new)**

Include, where possible:

- A description of the issue and its impact
- Steps to reproduce (a proof-of-concept helps enormously)
- Affected component — `backend/`, `native/`, `www/` or the action protocol
- Suspected severity
- Any suggested mitigation

### What to expect

| Stage | Target |
|---|---|
| Acknowledgement | within **72 hours** |
| Initial assessment | within **7 days** |
| Fix or mitigation for critical issues | as fast as reasonably possible |
| Public disclosure | coordinated with you, after a fix ships |

You'll be credited in the advisory and in the release notes unless you ask otherwise. This is a solo-maintained project — I'll be honest with you about timelines rather than over-promising.

---

## Supported Versions

| Version | Supported |
|---|---|
| Latest `main` | ✅ |
| Older commits | ❌ — please test against `main` |

---

## Scope

### In scope

- Authentication and authorization bypass in the backend
- Leakage of provider API keys or `FRIDAY_TOKEN`
- Flaws in the action protocol — confirmation bypass, lease manipulation, owner confusion, unauthorized device actions
- Injection into any request path (`/v1/chat`, `/v1/vision`, `/v1/web`, `/v1/memory`)
- Path traversal, SSRF or arbitrary file read/write
- Memory or action-queue data exposure across users
- Privilege escalation in the native Android layer
- Client-side key extraction

### Out of scope

- Vulnerabilities in third-party dependencies — report those upstream (Dependabot is enabled here)
- Issues requiring a rooted device, physical access, or an already-compromised OS
- Missing rate limits on endpoints that are already authenticated
- Findings from automated scanners with no demonstrated impact
- Social engineering against the maintainer
- Anything that requires the attacker to already hold your `FRIDAY_TOKEN`

---

## Security Design

Worth understanding before you probe, since some things that *look* like gaps are deliberate:

**Authentication is fail-closed.** A missing `FRIDAY_TOKEN` makes the server return `503` — it does not degrade to open access. `FRIDAY_ALLOW_INSECURE_LOCAL=true` is an explicit, opt-in development escape hatch.

**Constant-time comparison.** Token checks use `hmac.compare_digest` — no timing oracle.

**Identity is server-derived.** Database keys are `sha256(identity)[:32]`. The `X-User-ID` header is rejected unless `ALLOW_USER_HEADER=true` is explicitly enabled for a trusted multi-user deployment, and is strict-regex validated even then.

**Dangerous actions require confirmation.** High-safety-tier actions (calls, SMS) require the exact pending action id — a bare "yes" is not accepted, and confirmation is bound to the owning user.

**Missing details are never guessed.** A call request without a phone number fails; the system will not invent one.

**Startup validation.** Unsafe production configurations prevent the server from booting at all.

**Key redaction.** Diagnostics exports scrub anything matching a provider key pattern before writing a file.

---

## Operator Guidance

If you self-host the backend:

1. **Always set `FRIDAY_TOKEN`.** Generate with `openssl rand -hex 32`.
2. **Never leave `FRIDAY_ALLOW_INSECURE_LOCAL=true`** outside a throwaway local test.
3. **Keep `ALLOW_USER_HEADER=false`** unless you genuinely operate a trusted multi-user deployment.
4. **Restrict `CORS_ORIGINS`** to the origins you actually use — never `*` on a public host.
5. **Terminate TLS in front of it.** The server speaks plain HTTP; put it behind a reverse proxy.
6. **Keep provider keys server-side.** Never commit `backend/.env`.
7. **Rotate on exposure.** If a key ever reaches a commit, rotate it immediately — deleting the file does not remove it from git history.

---

## For Contributors

**Never commit secrets.** Not in code, not in comments, not in test fixtures, not in commit messages, not "temporarily". Use obvious placeholders such as `gsk_your_key_here`.

If you spot a credential in an issue, pull request or diff, report it privately rather than commenting publicly.

Given this project's history, please enable secret scanning locally before contributing:

```bash
pipx install detect-secrets
detect-secrets scan --baseline .secrets.baseline
```

---

Thank you for helping keep FRIDAY OS users safe. 🔒
