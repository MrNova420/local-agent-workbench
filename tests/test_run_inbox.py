import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "sidecar"))

from run_inbox import (  # noqa: E402
    QueuedPromptUnavailable,
    consume_queued_prompt,
    mutate_queue,
    run_request_identity,
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
