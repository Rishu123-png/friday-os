import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))

from action_protocol import ACTION_DEFINITIONS, ActionStore, PROTOCOL_VERSION, ProtocolError
from device_commands import confirmation_reply, normalize_device_tool, resolve_device_command


COMMANDS = [
    ("turn on flashlight", "device.torch.set", {"enabled": True}),
    ("set volume to 42 percent", "device.volume.set", {"percent": 42}),
    ("set brightness to 65%", "device.brightness.set", {"percent": 65}),
    ("turn wifi off", "device.wifi.set", {"enabled": False}),
    ("enable bluetooth", "device.bluetooth.set", {"enabled": True}),
    ("pause music", "media.control", {"command": "pause"}),
    ("open Spotify", "app.open", {"app": "Spotify"}),
    ("set an alarm for 7:30 pm called Gym", "alarm.create", {
        "hour": 19, "minute": 30, "label": "Gym", "repeat": "once"
    }),
    ("check battery status", "device.battery.get", {}),
    ("how much storage left", "device.storage.get", {}),
    ("read my notifications", "notifications.list", {}),
    ("read my screen", "screen.read", {}),
    ("take a screenshot", "screen.capture", {}),
    ("call +91 98765 43210", "phone.call", {"number": "+919876543210"}),
    ("send an sms to +91 98765 43210 saying I am on my way", "message.sms.send", {
        "number": "+919876543210", "body": "I am on my way"
    }),
]


def envelope(action_type, args, key, confirmed=False, expires=300):
    return {
        "protocol_version": PROTOCOL_VERSION,
        "type": action_type,
        "args": args,
        "idempotency_key": key,
        "expires_in_seconds": expires,
        "safety": {"confirmed": confirmed},
    }


def result_for(claimed, execution="succeeded", verification="verified", detail="Observed result"):
    return {
        "protocol_version": PROTOCOL_VERSION,
        "action_id": claimed["action_id"],
        "device_id": claimed["claimed_by"],
        "lease_token": claimed["lease_token"],
        "started_at": "2026-08-15T10:00:00Z",
        "finished_at": "2026-08-15T10:00:01Z",
        "execution": {"status": execution, "output": {"accepted": execution == "succeeded"}},
        "verification": {
            "status": verification,
            "method": "system_state" if verification == "verified" else "none",
            "detail": detail,
            "evidence": {"observed": verification == "verified"},
        },
    }


class DeterministicCommandTests(unittest.TestCase):
    def test_exactly_fifteen_protocol_actions_are_covered(self):
        self.assertEqual(len(ACTION_DEFINITIONS), 15)
        self.assertEqual({expected for _, expected, _ in COMMANDS}, set(ACTION_DEFINITIONS))

    def test_all_fifteen_everyday_commands_extract_exact_typed_args(self):
        for phrase, expected_type, expected_args in COMMANDS:
            with self.subTest(phrase=phrase):
                command = resolve_device_command(phrase)
                self.assertIsNotNone(command)
                self.assertEqual(command["type"], expected_type)
                self.assertEqual(command["args"], expected_args)
                self.assertTrue(command["summary"])

    def test_missing_dangerous_details_are_never_guessed(self):
        for phrase in ("call Mum", "send a message to Rishu", "set an alarm", "brightness please"):
            with self.subTest(phrase=phrase):
                self.assertIsNone(resolve_device_command(phrase))

    def test_confirmation_language_is_short_and_unambiguous(self):
        self.assertEqual(confirmation_reply("yes"), "confirm")
        self.assertEqual(confirmation_reply("kar do"), "confirm")
        self.assertEqual(confirmation_reply("cancel"), "cancel")
        self.assertIsNone(confirmation_reply("yes, and call somebody else"))
        self.assertIsNone(confirmation_reply("I said no yesterday"))

    def test_llm_device_tool_normalization_covers_every_type(self):
        for index, (_, action_type, args) in enumerate(COMMANDS):
            with self.subTest(action_type=action_type):
                normalized = normalize_device_tool({"type": action_type, "args": args, "ignored": index})
                self.assertEqual(normalized, {"type": action_type, "args": args})
        for bad in (None, [], {}, {"type": "shell.exec", "args": {}}, {"type": "app.open", "args": "Spotify"}):
            with self.subTest(bad=bad):
                with self.assertRaises(ValueError):
                    normalize_device_tool(bad)


class ActionStoreTests(unittest.TestCase):
    def setUp(self):
        self.store = ActionStore(":memory:", lease_seconds=30, max_attempts=2)
        self.user = "usr_owner"

    def tearDown(self):
        self.store.close()

    def enqueue_command(self, phrase, key, now=1000, confirmed=False, expires=300):
        command = resolve_device_command(phrase)
        return self.store.enqueue(
            self.user,
            envelope(command["type"], command["args"], key, confirmed, expires),
            now=now,
        )

    def test_all_fifteen_commands_pass_canonical_queue_validation(self):
        for index, (phrase, expected_type, expected_args) in enumerate(COMMANDS):
            item, created = self.enqueue_command(phrase, f"daily-command-{index:02d}", now=1000 + index)
            self.assertTrue(created)
            self.assertEqual(item["type"], expected_type)
            self.assertEqual(item["args"], expected_args)
            required = ACTION_DEFINITIONS[expected_type]["confirm"]
            self.assertEqual(item["state"], "awaiting_confirmation" if required else "queued")
            self.assertEqual(item["safety"]["confirmation_required"], required)

    def test_idempotent_enqueue_reuses_id_and_rejects_conflicting_payload(self):
        body = envelope("device.volume.set", {"percent": 40}, "retry-key-0001")
        first, created1 = self.store.enqueue(self.user, body, now=1000)
        second, created2 = self.store.enqueue(self.user, body, now=1001)
        self.assertTrue(created1)
        self.assertFalse(created2)
        self.assertEqual(first["action_id"], second["action_id"])
        with self.assertRaises(ProtocolError) as caught:
            self.store.enqueue(
                self.user,
                envelope("device.volume.set", {"percent": 41}, "retry-key-0001"),
                now=1002,
            )
        self.assertEqual(caught.exception.code, "idempotency_conflict")

    def test_confirmation_and_cancellation_are_bound_to_owner_and_action_id(self):
        first, _ = self.enqueue_command("call +91 98765 43210", "binding-call-0001")
        second, _ = self.enqueue_command(
            "send an sms to +91 98765 43210 saying hello", "binding-sms-0002"
        )
        self.assertIsNone(self.store.confirm("usr_other", first["action_id"], now=1001))
        self.assertEqual(self.store.get(self.user, first["action_id"], now=1001)["state"], "awaiting_confirmation")

        confirmed = self.store.confirm(self.user, first["action_id"], now=1002)
        self.assertEqual(confirmed["state"], "queued")
        self.assertTrue(confirmed["safety"]["confirmed"])
        self.assertEqual(self.store.get(self.user, second["action_id"], now=1002)["state"], "awaiting_confirmation")

        cancelled = self.store.cancel(self.user, second["action_id"], now=1003)
        self.assertEqual(cancelled["state"], "cancelled")
        self.assertEqual(self.store.get(self.user, first["action_id"], now=1003)["state"], "queued")

    def test_expired_action_cannot_be_revived_by_confirmation(self):
        pending, _ = self.enqueue_command(
            "call +91 98765 43210", "expires-call-001", now=1000, expires=30
        )
        expired = self.store.confirm(self.user, pending["action_id"], now=1030)
        self.assertEqual(expired["state"], "expired")
        self.assertFalse(expired["safety"]["confirmed"])
        self.assertIsNone(self.store.claim(self.user, "phone-device-1", {"phone"}, now=1031))

    def test_capability_filter_and_bounded_lease_retries(self):
        queued, _ = self.enqueue_command("turn on flashlight", "lease-torch-001", now=2000)
        self.assertIsNone(self.store.claim(self.user, "phone-device-1", {"volume"}, now=2001))
        first = self.store.claim(self.user, "phone-device-1", {"torch"}, now=2001)
        self.assertEqual(first["action_id"], queued["action_id"])
        self.assertEqual(first["attempt"], 1)

        second = self.store.claim(self.user, "phone-device-1", {"torch"}, now=2031)
        self.assertEqual(second["action_id"], queued["action_id"])
        self.assertEqual(second["attempt"], 2)
        self.assertNotEqual(first["lease_token"], second["lease_token"])

        self.assertIsNone(self.store.claim(self.user, "phone-device-1", {"torch"}, now=2061))
        self.assertEqual(self.store.get(self.user, queued["action_id"], now=2061)["state"], "failed")

    def test_claimed_action_cancellation_is_not_falsely_guaranteed(self):
        queued, _ = self.enqueue_command("turn on flashlight", "claimed-cancel-01", now=3000)
        self.store.claim(self.user, "phone-device-1", {"torch"}, now=3001)
        with self.assertRaises(ProtocolError) as caught:
            self.store.cancel(self.user, queued["action_id"], now=3002)
        self.assertEqual(caught.exception.code, "invalid_state")
        self.assertEqual(self.store.get(self.user, queued["action_id"], now=3002)["state"], "claimed")

    def test_result_state_requires_real_verification_and_result_retry_is_idempotent(self):
        cases = [
            ("verified", "succeeded"),
            ("unavailable", "unverified"),
            ("not_required", "unverified"),
            ("failed", "failed"),
        ]
        for index, (verification, expected_state) in enumerate(cases):
            with self.subTest(verification=verification):
                item, _ = self.store.enqueue(
                    self.user,
                    envelope("device.volume.set", {"percent": 10 + index}, f"result-case-{index:03d}"),
                    now=4000 + index * 100,
                )
                claimed = self.store.claim(
                    self.user, "phone-device-1", {"volume"}, now=4001 + index * 100
                )
                body = result_for(claimed, verification=verification)
                completed = self.store.submit_result(
                    self.user, item["action_id"], body, now=4002 + index * 100
                )
                self.assertEqual(completed["state"], expected_state)
                self.assertNotIn("lease_token", completed["result"])
                retried = self.store.submit_result(
                    self.user, item["action_id"], body, now=4003 + index * 100
                )
                self.assertEqual(retried["state"], expected_state)

    def test_execution_failure_unsupported_and_denied_are_honest_terminal_states(self):
        for index, (execution, expected) in enumerate((
            ("failed", "failed"), ("unsupported", "unsupported"), ("denied", "denied")
        )):
            item, _ = self.store.enqueue(
                self.user,
                envelope("device.battery.get", {}, f"execution-case-{index:02d}"),
                now=5000 + index * 100,
            )
            claimed = self.store.claim(
                self.user, "phone-device-1", {"battery"}, now=5001 + index * 100
            )
            completed = self.store.submit_result(
                self.user,
                item["action_id"],
                result_for(claimed, execution=execution, verification="unavailable"),
                now=5002 + index * 100,
            )
            self.assertEqual(completed["state"], expected)


if __name__ == "__main__":
    unittest.main()
