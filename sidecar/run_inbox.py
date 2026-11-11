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
