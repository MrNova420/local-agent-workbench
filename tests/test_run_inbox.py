import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "sidecar"))

from run_inbox import (  # noqa: E402
    active_reply_identity_matches,
    find_prior_steering_update,
    validate_steering_identity,
    validate_steering_request_id,
    QueuedPromptUnavailable,
    consume_queued_prompt,
    mutate_queue,
    run_request_identity,
    run_start_replay_decision,
    SessionInbox,
    validated_queued_prompts,
)


class RunRequestIdentityTests(unittest.TestCase):
    def test_missing_id_returns_none_pair(self):
        self.assertEqual(run_request_identity({"prompt": "hi"}), (None, None))

    def test_invalid_ids_rejected(self):
        for bad in ("", "   ", 7, True, "x" * 257):
            with self.assertRaises(ValueError):
                run_request_identity({"clientRequestId": bad})

    def test_fingerprint_excludes_identity_fields(self):
        base = {"clientRequestId": "same", "prompt": "task", "model": "m", "context": 65536}
        first = run_request_identity(base, workspace="C:/proj")
        second = run_request_identity(base, workspace="C:/proj")
        self.assertEqual(first, second)
        changed_prompt = run_request_identity({**base, "prompt": "other"}, workspace="C:/proj")
        self.assertNotEqual(first[1], changed_prompt[1])
        queued_variant = {**base, "queuedPromptId": "q1"}
        self.assertEqual(first[1], run_request_identity(queued_variant, workspace="C:/proj")[1])


class RunStartReplayTests(unittest.TestCase):
    def _state(self, request_id: str, fingerprint: str | None, prompt: str = "task"):
        return {"turns": [{"client_request_id": request_id, "request_fingerprint": fingerprint,
                           "turn_id": "t1", "status": "completed", "prompt": prompt}]}

    def test_new_request_returns_none(self):
        self.assertIsNone(run_start_replay_decision({"turns": []}, "r1", "f1", "task"))

    def test_matching_replay_reports_prior_turn(self):
        decision = run_start_replay_decision(self._state("r1", "f1"), "r1", "f1", "task")
        self.assertEqual(decision, {"priorTurnId": "t1", "priorTurnStatus": "completed"})

    def test_conflicting_fingerprint_rejected(self):
        with self.assertRaises(ValueError):
            run_start_replay_decision(self._state("r1", "f1"), "r1", "f2", "task")

    def test_legacy_turn_falls_back_to_prompt_match(self):
        state = self._state("r1", None)
        with self.assertRaises(ValueError):
            run_start_replay_decision(state, "r1", "f1", "different")
        decision = run_start_replay_decision(state, "r1", "f1", "task")
        self.assertEqual(decision["priorTurnId"], "t1")


class SessionInboxTests(unittest.TestCase):
    def test_new_run_acquires_single_active_slot_then_releases_on_idle_result(self):
        inbox = SessionInbox()
        calls = []
        result = inbox.admit(lambda: None, lambda: calls.append("start") or {"started": True})
        self.assertEqual(result, {"started": True})
        self.assertEqual(calls, ["start"])
        with self.assertRaisesRegex(RuntimeError, "already running"):
            inbox.admit(lambda: None, lambda: calls.append("second"))
        self.assertEqual(calls, ["start"])
        inbox.run_lock.release()

    def test_replay_returns_without_acquiring_or_starting(self):
        inbox = SessionInbox()
        replay = {"started": False, "runAlreadyStarted": True, "turnId": "t1",
                  "clientRequestId": "req-1"}
        result = inbox.admit(lambda: replay, lambda: self.fail("replayed request must not start"), request_id="req-1")
        self.assertIs(result, replay)
        self.assertFalse(inbox.run_lock.locked())

    def test_replay_must_confirm_same_client_request_id(self):
        inbox = SessionInbox()
        replay = {"started": False, "runAlreadyStarted": True, "clientRequestId": "other"}
        with self.assertRaisesRegex(ValueError, "does not confirm"):
            inbox.admit(lambda: replay, lambda: self.fail("mismatched replay must not start"), request_id="req-1")
        self.assertFalse(inbox.run_lock.locked())

    def test_second_replay_check_wins_race_after_slot_busy(self):
        inbox = SessionInbox()
        self.assertEqual(inbox.admit(lambda: None, lambda: {"started": True}), {"started": True})
        lookups = 0
        replay = {"started": False, "runAlreadyStarted": True, "turnId": "t2"}
        def replay_lookup():
            nonlocal lookups
            lookups += 1
            return None if lookups == 1 else replay
        self.assertIs(inbox.admit(replay_lookup, lambda: self.fail("busy slot must prevent start")), replay)
        self.assertEqual(lookups, 2)
        inbox.run_lock.release()

    def test_failed_start_releases_active_slot(self):
        inbox = SessionInbox()
        with self.assertRaisesRegex(ValueError, "bad start"):
            inbox.admit(lambda: None, lambda: (_ for _ in ()).throw(ValueError("bad start")))
        self.assertFalse(inbox.run_lock.locked())

    def test_same_request_retry_waits_for_start_then_replays(self):
        import threading
        inbox = SessionInbox()
        started = threading.Event()
        finish = threading.Event()
        replay = {"started": False, "runAlreadyStarted": True, "turnId": "turn-1",
                  "clientRequestId": "req-1"}
        calls = []
        def lookup():
            return replay if started.is_set() else None
        def start():
            calls.append("start")
            started.set()
            self.assertTrue(finish.wait(2))
            return {"started": True, "turnId": "turn-1"}
        first_result = []
        first = threading.Thread(target=lambda: first_result.append(inbox.admit(lookup, start, request_id="req-1")))
        first.start()
        self.assertTrue(started.wait(2))
        releaser = threading.Timer(0.1, finish.set)
        releaser.start()
        second_result = inbox.admit(lookup, lambda: self.fail("duplicate request started twice"), request_id="req-1")
        releaser.join(2)
        first.join(2)
        self.assertFalse(first.is_alive())
        self.assertEqual(calls, ["start"])
        self.assertEqual(first_result, [{"started": True, "turnId": "turn-1"}])
        self.assertIs(second_result, replay)
        inbox.run_lock.release()

    def test_non_started_result_releases_active_slot(self):
        inbox = SessionInbox()
        result = {"started": False, "queuedPromptUnavailable": True}
        self.assertIs(inbox.admit(lambda: None, lambda: result), result)
        self.assertFalse(inbox.run_lock.locked())


class QueueTests(unittest.TestCase):
    def _state(self):
        return {"queued_prompts": [{"id": "a", "prompt": "first", "queued_at": 1.0}]}

    def test_validation_rejects_malformed_rows(self):
        for rows in ("no", [None], [{"id": "", "prompt": "x", "queued_at": 1.0}],
                     [{"id": "a", "prompt": "  ", "queued_at": 1.0}],
                     [{"id": "a", "prompt": "x", "queued_at": True}],
                     [{"id": "a", "prompt": "x", "queued_at": 1.0}, {"id": "a", "prompt": "y", "queued_at": 2.0}]):
            with self.assertRaises(ValueError):
                validated_queued_prompts({"queued_prompts": rows})

    def test_consume_requires_exact_prompt_match(self):
        state = self._state()
        item = consume_queued_prompt(state, "a", "first")
        self.assertEqual(item["prompt"], "first")
        self.assertEqual(state["queued_prompts"], [])
        with self.assertRaises(ValueError):
            consume_queued_prompt(self._state(), "a", "different")

    def test_consume_missing_raises_unavailable(self):
        with self.assertRaises(QueuedPromptUnavailable):
            consume_queued_prompt(self._state(), "gone", "first")

    def test_mutate_add_and_remove(self):
        result = mutate_queue([], add_prompt="  new task  ", request_id="req-1")
        self.assertTrue(result["queued"])
        self.assertEqual(result["queued"]["prompt"], "new task")
        self.assertEqual(result["queued"]["request_id"], "req-1")
        removal = mutate_queue(result["queuedPrompts"], add_prompt=None, remove_id=result["queued"]["id"])
        self.assertTrue(removal["removed"])
        self.assertEqual(removal["queuedPrompts"], [])
        self.assertFalse(mutate_queue([], add_prompt=None, remove_id="missing")["removed"])

    def test_mutate_rejects_blank_prompt(self):
        with self.assertRaises(ValueError):
            mutate_queue([], add_prompt="   ")

    def test_mutate_does_not_share_state_with_input(self):
        prompts = [{"id": "a", "prompt": "p", "queued_at": 1.0}]
        result = mutate_queue(prompts, add_prompt="q")
        result["queuedPrompts"][0]["prompt"] = "mutated"
        self.assertEqual(prompts[0]["prompt"], "p")


if __name__ == "__main__":
    unittest.main()


class ActiveReplyIdentityTests(unittest.TestCase):
    def _controller(self, workspace="C:/proj"):
        return {"session": {"session_id": "s1", "workspace": workspace}, "turn_id": "t1"}

    def test_matching_identity(self):
        self.assertTrue(active_reply_identity_matches(self._controller(), "s1", "t1"))
        self.assertTrue(active_reply_identity_matches(self._controller(), "s1", "t1", "C:/proj"))
        self.assertTrue(active_reply_identity_matches(self._controller(), "s1", "t1", "c:\\proj\\"))

    def test_rejects_missing_or_mismatched(self):
        self.assertFalse(active_reply_identity_matches(None, "s1", "t1"))
        self.assertFalse(active_reply_identity_matches(self._controller(), "s2", "t1"))
        self.assertFalse(active_reply_identity_matches(self._controller(), "s1", "t2"))
        self.assertFalse(active_reply_identity_matches(self._controller(), "s1", "t1", "C:/other"))
        self.assertFalse(active_reply_identity_matches({"session": "nope"}, "s1", "t1"))

    def test_workspace_optional(self):
        self.assertTrue(active_reply_identity_matches(self._controller(), "s1", "t1", None))


class SteeringValidationTests(unittest.TestCase):
    def _controller(self, workspace="C:/proj"):
        return {"session": {"session_id": "s1", "workspace": workspace}, "turn_id": "t1"}

    def test_request_id_rules(self):
        self.assertIsNone(validate_steering_request_id(None))
        self.assertEqual(validate_steering_request_id("  abc  "), "abc")
        for bad in ("", "   ", 7, True, "x" * 257):
            with self.assertRaises(ValueError):
                validate_steering_request_id(bad)

    def test_identity_matching(self):
        state = validate_steering_identity(self._controller(), "s1", Path("C:/proj"))
        self.assertEqual(state["session_id"], "s1")
        with self.assertRaises(RuntimeError):
            validate_steering_identity(self._controller(), "s2", Path("C:/proj"))
        with self.assertRaises(ValueError):
            validate_steering_identity(self._controller(), "s1", Path("C:/other"))

    def test_prior_update_lookup(self):
        checkpoint = {"current": {"user_updates": [{"client_request_id": "r1", "id": "u1"}]},
                      "task_history": [{"user_updates": [{"client_request_id": "r0", "id": "u0"}]}]}
        prior = find_prior_steering_update(checkpoint, "r1")
        self.assertEqual(prior["id"], "u1")
        self.assertEqual(find_prior_steering_update(checkpoint, "r0")["id"], "u0")
        self.assertIsNone(find_prior_steering_update(checkpoint, "missing"))
        self.assertIsNone(find_prior_steering_update(checkpoint, None))
