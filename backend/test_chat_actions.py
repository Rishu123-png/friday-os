import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))

try:
    from fastapi.testclient import TestClient
except ImportError:  # A clear skip in minimal protocol-only environments.
    TestClient = None

from config import settings


TOKEN = "test-only-friday-token-32-characters-minimum"


def sse_events(response):
    events = []
    for line in response.text.splitlines():
        if line.startswith("data:"):
            events.append(json.loads(line[5:].strip()))
    return events


def event_text(events):
    return "".join(event.get("text", "") for event in events if event.get("type") == "token")


def action_event(events):
    return next(event for event in events if event.get("type") == "action")


@unittest.skipIf(TestClient is None, "FastAPI test dependencies are not installed")
class ChatActionIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        settings.FRIDAY_TOKEN = TOKEN
        settings.FRIDAY_ALLOW_INSECURE_LOCAL = False
        settings.ALLOW_USER_HEADER = False
        settings.ACTION_DB_PATH = str(Path(cls.temp.name) / "actions.db")
        settings.DB_PATH = str(Path(cls.temp.name) / "memory.db")
        settings.TELEGRAM_BOT_TOKEN = ""
        settings.TELEGRAM_ALLOWED_IDS = ""

        import main
        import memory
        cls.main = main
        cls.memory = memory
        cls.original_loop = main.run_tool_loop

        async def offline_loop(_messages, _brief, _enqueue=None):
            yield {"type": "token", "text": "No matching pending action was authorized."}
            yield {"type": "done"}

        main.run_tool_loop = offline_loop
        cls.client_context = TestClient(main.app)
        cls.client = cls.client_context.__enter__()
        cls.headers = {"Authorization": f"Bearer {TOKEN}"}

    @classmethod
    def tearDownClass(cls):
        cls.client_context.__exit__(None, None, None)
        cls.main.run_tool_loop = cls.original_loop
        if cls.memory._conn is not None:
            cls.memory._conn.close()
            cls.memory._conn = None
        cls.temp.cleanup()

    def chat(self, text, request_id, pending=None):
        body = {
            "messages": [{"role": "user", "content": text}],
            "chat_request_id": request_id,
        }
        if pending is not None:
            body["pending_action_id"] = pending
        response = self.client.post("/v1/chat", headers=self.headers, json=body)
        self.assertEqual(response.status_code, 200, response.text)
        return sse_events(response)

    def test_chat_retry_is_idempotent_and_queue_wording_never_claims_completion(self):
        first = self.chat("set volume to 35 percent", "chat-idempotent-volume-001")
        second = self.chat("set volume to 35 percent", "chat-idempotent-volume-001")
        first_action = action_event(first)["action"]
        second_action = action_event(second)["action"]
        self.assertEqual(first_action["action_id"], second_action["action_id"])
        self.assertEqual(first_action["state"], "queued")
        text = event_text(first).lower()
        self.assertIn("queued", text)
        self.assertIn("not been reported as completed", text)
        self.assertNotIn("done", text)

    def test_bare_yes_cannot_confirm_and_exact_pending_id_can(self):
        created = self.chat("call +91 98765 43210", "chat-binding-call-0001")
        pending = action_event(created)["action"]
        self.assertEqual(pending["state"], "awaiting_confirmation")
        self.assertIn("nothing has run yet", event_text(created).lower())

        bare = self.chat("yes", "chat-binding-bare-yes-0002")
        self.assertIn("no matching pending action", event_text(bare).lower())
        unchanged = self.client.get(
            f"/v1/actions/{pending['action_id']}", headers=self.headers
        ).json()
        self.assertEqual(unchanged["state"], "awaiting_confirmation")

        confirmed = self.chat(
            "yes", "chat-binding-exact-yes-0003", pending=pending["action_id"]
        )
        queued = action_event(confirmed)["action"]
        self.assertEqual(queued["action_id"], pending["action_id"])
        self.assertEqual(queued["state"], "queued")
        self.assertIn("not been reported as completed", event_text(confirmed).lower())

    def test_cancellation_is_bound_to_exact_pending_id(self):
        created = self.chat(
            "send an sms to +91 98765 43210 saying hello",
            "chat-binding-sms-create-01",
        )
        pending = action_event(created)["action"]
        wrong = self.chat("cancel", "chat-binding-wrong-cancel-02", pending="not-a-real-action")
        self.assertIn("couldn't find", event_text(wrong).lower())
        unchanged = self.client.get(
            f"/v1/actions/{pending['action_id']}", headers=self.headers
        ).json()
        self.assertEqual(unchanged["state"], "awaiting_confirmation")

        cancelled = self.chat(
            "cancel", "chat-binding-right-cancel-03", pending=pending["action_id"]
        )
        action = action_event(cancelled)["action"]
        self.assertEqual(action["state"], "cancelled")
        self.assertIn("had not claimed it", event_text(cancelled).lower())

    def test_unavailable_verification_is_reported_as_unverified_not_done(self):
        queued = action_event(self.chat(
            "check battery status", "chat-honest-battery-001"
        ))["action"]
        claimed_response = self.client.post(
            "/v1/actions/claim",
            headers=self.headers,
            json={
                "protocol_version": "1.0",
                "device_id": "android-test-device",
                "capabilities": ["battery"],
            },
        )
        self.assertEqual(claimed_response.status_code, 200, claimed_response.text)
        claimed = claimed_response.json()
        self.assertEqual(claimed["action_id"], queued["action_id"])

        detail = "Battery query was accepted, but this build could not independently observe a result."
        submitted = self.client.post(
            f"/v1/actions/{queued['action_id']}/result",
            headers=self.headers,
            json={
                "protocol_version": "1.0",
                "action_id": queued["action_id"],
                "device_id": "android-test-device",
                "lease_token": claimed["lease_token"],
                "started_at": "2026-08-15T10:00:00Z",
                "finished_at": "2026-08-15T10:00:01Z",
                "execution": {"status": "succeeded", "output": {"accepted": True}},
                "verification": {
                    "status": "unavailable", "method": "none",
                    "detail": detail, "evidence": {}
                },
            },
        )
        self.assertEqual(submitted.status_code, 200, submitted.text)
        self.assertEqual(submitted.json()["state"], "unverified")

        status = self.chat(
            "yes", "chat-honest-status-002", pending=queued["action_id"]
        )
        text = event_text(status)
        self.assertEqual(text, detail)
        self.assertNotIn("done", text.lower())
        self.assertEqual(action_event(status)["action"]["state"], "unverified")

    def test_action_routes_require_authentication(self):
        response = self.client.get("/v1/actions/capabilities")
        self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()
