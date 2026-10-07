## What does this PR do?

<!-- One or two sentences. Link the issue it closes, e.g. "Closes #42". -->

## Type of change

- [ ] 🐛 Bug fix (non-breaking)
- [ ] ✨ New feature (non-breaking)
- [ ] 💥 Breaking change
- [ ] ♻️ Refactor (no behaviour change)
- [ ] 📝 Documentation
- [ ] 🧪 Tests
- [ ] 🏗️ Build / CI

## Which area?

- [ ] `www/` — HUD / frontend
- [ ] `native/` — Android layer
- [ ] `backend/` — FastAPI server
- [ ] `protocol/` — action schema
- [ ] `tests/`
- [ ] docs / CI

## How was this tested?

<!-- Be specific. "Ran the suite" is fine for small changes; describe manual testing for UI or device work. -->

- [ ] `npm test` passes
- [ ] Added tests for new behaviour
- [ ] Manually verified on device / in browser

## Security checklist

- [ ] **No secrets committed** — no keys, tokens, or `.env` files anywhere in this diff
- [ ] No real personal data in tests or fixtures (used `+919876543210` / `user@example.com` style placeholders)
- [ ] No new dependency added without prior discussion in an issue

## Protocol changes (if applicable)

- [ ] Updated **both** `protocol/action-v1.schema.json` **and** `backend/action_protocol.py`
- [ ] Assigned a correct safety tier (`low` / `medium` / `high`)
- [ ] Missing dangerous arguments fail loudly rather than being guessed
- [ ] Added tests for the new action's validation edge cases

## Anything you're unsure about?

<!-- Reviewers can't help with what you don't mention. Flag the risky or debatable parts. -->

## Screenshots / recordings

<!-- For UI changes. Before/after is ideal. Delete this section if not applicable. -->
