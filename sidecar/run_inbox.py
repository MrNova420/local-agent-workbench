"""Durable admission primitives for the agent session inbox.

Stage 1 of the agent flow rework consolidates the scattered request-identity,
queue, and replay checks into one module. The sidecar's separate entry points
(run start, queued-prompt start, steering, queue edits) all funnel through
these primitives so admission, idempotency, and replay behavior stay
coherent. Behavior is intentionally identical to the previous inline logic in
``worker.py``; the 2026-11-08 rework design (``docs/design/agent-flow-rework.md``)
records the rationale.
"""
from __future__ import annotations

import copy
import hashlib
import json
import time
import uuid
from pathlib import Path
from typing import Any

try:
    from task_checkpoint import current_task
except ImportError:  # pragma: no cover - engine import differs when frozen
    current_task = lambda checkpoint: checkpoint.get("current")  # type: ignore[assignment]


class SessionInbox:
    """Session-scoped admission lock and active-run gate.

    This facade centralizes the serialization rules for run admission while
    retaining the worker's existing external locks/behavior. It is not yet a
    durable event inbox: durable journal events and safe-boundary delivery
    remain in AgentService/AgentEngine and will be migrated in later stages.
    """

    def __init__(self) -> None:
        import threading
        self.admission_lock = threading.Lock()
        self.run_lock = threading.Lock()

    def admit(self, replay_lookup, start_run, *, request_id: str | None = None):
        """Replay an idempotent request or acquire the single active-run slot.

        When a client request ID is supplied, a replay result must identify that
        same request. This prevents a stale/unrelated replay lookup result from
        acknowledging a different submission.
        """
        def checked_replay():
            replay = replay_lookup()
            if replay is not None and request_id is not None:
                matched = replay.get("clientRequestId", replay.get("client_request_id")) if isinstance(replay, dict) else None
                if matched != request_id:
                    raise ValueError("Replay result does not confirm the submitted client request ID.")
            return replay

        with self.admission_lock:
            replay = checked_replay()
            if replay is not None:
                return replay
            if not self.run_lock.acquire(blocking=False):
                # Another request may have completed admission between our first
                # replay lookup and the active-slot check. Recheck once while
                # serialized so duplicate IPC retries replay instead of reporting
                # a generic busy error.
                replay = checked_replay()
                if replay is not None:
                    return replay
                raise RuntimeError("A task is already running.")
            try:
                result = start_run()
                if isinstance(result, dict) and result.get("started") is False:
                    self.run_lock.release()
                return result
            except Exception:
                self.run_lock.release()
                raise


class QueuedPromptUnavailable(ValueError):
    """The selected queue row vanished after the run-start preflight check."""


def run_start_replay_decision(state: dict[str, Any], request_id: str, fingerprint: str | None,
                              prompt: str) -> dict[str, Any] | None:
    """Decide whether an ordinary run request is a replay of a recorded turn.

    Returns the replay result when the request ID matches a prior turn of the
    same session, ``None`` when the request is new. A saved fingerprint that
    differs from the presented one (or an absent fingerprint with different
    prompt text) is rejected so one request ID cannot carry different work.
    The caller supplies active-run state separately.
    """
    turns = state.get("turns", [])
    prior = next((row for row in reversed(turns) if isinstance(row, dict)
                  and row.get("client_request_id") == request_id), None) if isinstance(turns, list) else None
    if prior is None:
        return None
    saved_fingerprint = prior.get("request_fingerprint")
    if ((isinstance(saved_fingerprint, str) and saved_fingerprint != fingerprint)
            or (not isinstance(saved_fingerprint, str) and prior.get("prompt") != prompt)):
        raise ValueError("This run request ID was already used for different task settings.")
    return {"priorTurnId": str(prior.get("turn_id", "")),
            "priorTurnStatus": str(prior.get("status", "unknown"))}


def active_reply_identity_matches(controller: dict[str, Any] | None, session_id: str, turn_id: str,
                                  workspace: str | None = None) -> bool:
    """Validate that a reply targets the currently active captured run.

    Approval, question, and stop decisions carry the captured session, turn,
    and (for approvals) workspace identity; a stale reply for a finished or
    newer run must be rejected rather than applied. ``controller`` is the
    active-run record under the worker's ``active_lock``.
    """
    if not isinstance(controller, dict):
        return False
    state = controller.get("session")
    if not isinstance(state, dict) or state.get("session_id") != session_id:
        return False
    if controller.get("turn_id") != turn_id:
        return False
    if workspace is not None and Path(state.get("workspace", "")).resolve() != Path(workspace).resolve():
        return False
    return True


def validate_steering_identity(controller: dict[str, Any], session_id: str, workspace: Path) -> dict[str, Any]:
    """Validate a steering request against the active captured run.

    Returns the controller's session state when the steering target matches
    the active session and workspace; raises the historical user-facing
    errors otherwise. Steer is intentionally stricter than bool-returning
    reply paths because the composer surfaces the reason.
    """
    state = controller.get("session") if isinstance(controller, dict) else None
    if not isinstance(state, dict) or state.get("session_id") != session_id:
        raise RuntimeError("Steering is limited to the task's captured chat session.")
    if Path(state.get("workspace", "")).resolve(strict=False) != workspace.resolve():
        raise ValueError("The active task belongs to a different project.")
    return state


def validate_steering_request_id(client_request_id: Any) -> str | None:
    """Validate the optional steering idempotency key; returns the stripped id."""
    if client_request_id is None:
        return None
    if not isinstance(client_request_id, str) or not client_request_id.strip() or len(client_request_id) > 256:
        raise ValueError("Steering request identity must be a non-empty string of at most 256 characters.")
    return client_request_id.strip()


def find_prior_steering_update(checkpoint: dict[str, Any], client_request_id: str | None) -> dict[str, Any] | None:
    """Locate a prior durably saved user update with the same request ID."""
    if not client_request_id:
        return None
    current = current_task(checkpoint)
    task_history = checkpoint.get("task_history", [])
    saved_tasks = [*([row for row in task_history if isinstance(row, dict)] if isinstance(task_history, list) else []), current]
    prior_updates = [update for task in saved_tasks for update in
                     (task.get("user_updates", []) if isinstance(task.get("user_updates", []), list) else [])]
    return next((row for row in reversed(prior_updates)
                 if isinstance(row, dict) and row.get("client_request_id") == client_request_id), None)


def validated_queued_prompts(state: dict[str, Any]) -> list[dict[str, Any]]:
    rows = state.get("queued_prompts", [])
    if not isinstance(rows, list):
        raise ValueError("Saved follow-up prompt queue is invalid.")
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in rows:
        if (not isinstance(row, dict) or not isinstance(row.get("id"), str) or not row["id"]
                or row["id"] in seen or not isinstance(row.get("prompt"), str) or not row["prompt"].strip()
                or isinstance(row.get("queued_at"), bool) or not isinstance(row.get("queued_at"), (int, float))):
            raise ValueError("Saved follow-up prompt queue contains an invalid entry.")
        seen.add(row["id"])
        result.append(copy.deepcopy(row))
    return result


def run_request_identity(options: dict[str, Any], workspace: Path | None = None) -> tuple[str | None, str | None]:
    request_id = options.get("clientRequestId")
    if request_id is None:
        return None, None
    if not isinstance(request_id, str) or not request_id.strip() or len(request_id) > 256:
        raise ValueError("Run request identity must be a non-empty string of at most 256 characters.")
    request_id = request_id.strip()
    fingerprint_options = {key: value for key, value in options.items()
                          if key not in {"clientRequestId", "queuedPromptId"}}
    payload = {"workspace": str(workspace) if workspace is not None else options.get("workspace"),
               "options": fingerprint_options}
    encoded = json.dumps(payload, ensure_ascii=True, sort_keys=True, separators=(",", ":"), default=str).encode("ascii")
    return request_id, hashlib.sha256(encoded).hexdigest()


def consume_queued_prompt(state: dict[str, Any], queued_prompt_id: str, prompt: str) -> dict[str, Any]:
    rows = validated_queued_prompts(state)
    index = next((index for index, row in enumerate(rows) if row["id"] == queued_prompt_id), None)
    if index is None:
        raise QueuedPromptUnavailable("That queued prompt no longer exists.")
    item = rows[index]
    if item["prompt"] != prompt:
        raise ValueError("The queued prompt text does not match the selected queue entry.")
    state["queued_prompts"] = [row for row in rows if row["id"] != queued_prompt_id]
    return item


def mutate_queue(prompts: list[dict[str, Any]], *, add_prompt: str | None = None,
                 remove_id: str | None = None, request_id: str | None = None) -> dict[str, Any]:
    updated = copy.deepcopy(prompts)
    if add_prompt is not None:
        clean = add_prompt.strip()
        if not clean:
            raise ValueError("Enter a follow-up prompt before queuing it.")
        item = {"id": uuid.uuid4().hex, "prompt": clean, "queued_at": time.time()}
        if request_id:
            item["request_id"] = request_id
        updated.append(item)
        return {"queued": item, "removed": False, "queuedPrompts": updated}
    removed = next((item for item in updated if item.get("id") == remove_id), None)
    if removed is not None:
        updated = [item for item in updated if item.get("id") != remove_id]
    return {"queued": None, "removed": removed is not None, "queuedPrompts": updated}
