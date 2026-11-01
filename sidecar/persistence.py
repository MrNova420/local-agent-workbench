"""Project identity, mirrored session persistence, and durable workspace recents."""
from __future__ import annotations

import copy
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path
from typing import Any

_core_path = os.environ.get("LOCAL_AGENT_CORE_PATH")
if _core_path and Path(_core_path).is_dir() and _core_path not in sys.path:
    sys.path.insert(0, _core_path)
from sessions import SessionStore
from task_checkpoint import record_plan


def _atomic_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False, dir=path.parent,
                                         prefix=path.stem + "-", suffix=".tmp") as handle:
            temporary = Path(handle.name)
            json.dump(value, handle, indent=2, ensure_ascii=False)
            handle.flush()
            os.fsync(handle.fileno())
        delay = 0.05
        for attempt in range(7):
            try:
                os.replace(temporary, path)
                break
            except PermissionError:
                if attempt == 6:
                    raise
                time.sleep(delay)
                delay = min(delay * 2, 0.4)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _append_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    if not rows:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = "".join(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n" for row in rows)
    delay = 0.05
    for attempt in range(7):
        try:
            with path.open("a", encoding="utf-8", newline="\n") as handle:
                handle.write(payload)
                handle.flush()
                os.fsync(handle.fileno())
            return
        except PermissionError:
            if attempt == 6:
                raise
            time.sleep(delay)
            delay = min(delay * 2, 0.4)


def _normalize_path(value: str | Path) -> str:
    return os.path.normcase(str(Path(value).resolve()))


def _replay_run_event(state: dict[str, Any], event: dict[str, Any]) -> None:
    """Rebuild run progress after the last full snapshot from the append-only event journal."""
    kind = event.get("type")
    run = state.get("run_state")
    if not isinstance(run, dict):
        return
    if kind == "phase" and event.get("phase") == "waiting":
        safe_messages = run.get("safe_messages")
        if not isinstance(safe_messages, list):
            safe_messages = copy.deepcopy(state.get("messages", []))
        prompt = str(run.get("prompt", ""))
        if prompt and not run.get("safe_prompt_included"):
            safe_messages.append({"role": "user", "content": prompt})
            run["safe_prompt_included"] = True
        partial = {key: run.get(field, "") for key, field in (("content", "partial_content"), ("thinking", "partial_thinking"))
                   if isinstance(run.get(field), str) and run.get(field)}
        if partial:
            last = safe_messages[-1] if safe_messages and isinstance(safe_messages[-1], dict) else {}
            if last.get("role") != "assistant" or any(last.get(key, "") != value for key, value in partial.items()):
                safe_messages.append({"role": "assistant", **partial})
        run["safe_messages"] = safe_messages
        run.update(tool_batch=None, completed_tool_results={}, partial_content="", partial_thinking="")
    elif kind == "text":
        run["partial_content"] = str(run.get("partial_content", "")) + str(event.get("text", ""))
    elif kind == "thinking":
        run["partial_thinking"] = str(run.get("partial_thinking", "")) + str(event.get("text", ""))
    elif kind == "inference_settings":
        run["estimated_input_tokens"] = event.get("estimated_input_tokens")
        request_index = event.get("request_index")
        prompt = next((item for item in reversed(state.setdefault("activity_events", []))
                       if item.get("kind") == "prompt"
                       and item.get("turnId") == event.get("turnId", run.get("turn_id"))
                       and isinstance(item.get("promptManifest"), dict)
                       and item["promptManifest"].get("request_index") == request_index), None)
        if prompt is not None:
            prompt["providerRequest"] = {
                key: copy.deepcopy(event[key])
                for key in ("provider", "request_api", "request_index", "model", "api_model", "stream", "tool_count", "requested_context",
                            "runtime_context", "max_output_tokens", "reasoning_override", "runtime_reasoning",
                            "reasoning_field_sent", "keep_alive", "request_options", "additional_fields",
                            "estimated_input_tokens", "input_estimate_method")
                if key in event
            }
            prompt["providerRequest"]["dispatch_status"] = "prepared"
            prompt["status"] = "prepared"
    elif kind in {"request_dispatched", "request_headers", "request_complete", "request_error"}:
        request_index = event.get("request_index")
        prompt = next((item for item in reversed(state.setdefault("activity_events", []))
                       if item.get("kind") == "prompt"
                       and item.get("turnId") == event.get("turnId", run.get("turn_id"))
                       and isinstance(item.get("promptManifest"), dict)
                       and item["promptManifest"].get("request_index") == request_index), None)
        if prompt is not None:
            provider_request = prompt.setdefault("providerRequest", {"request_index": request_index})
            if kind == "request_dispatched":
                prompt["status"] = "awaiting_response_headers"
                provider_request["dispatch_status"] = "awaiting_response_headers"
            elif kind == "request_headers":
                prompt["status"] = "response_headers_received"
                provider_request.update(dispatch_status="response_headers_received",
                                        http_status=event.get("http_status"), http_reason=event.get("http_reason"),
                                        header_wait_seconds=event.get("header_wait_seconds"))
            elif kind == "request_complete":
                prompt["status"] = "response_stream_ended"
                provider_request.update(dispatch_status="response_stream_ended",
                                        provider_done=event.get("provider_done"))
            else:
                prompt["status"] = "cancelled_during_request" if event.get("cancelled") else "request_failed"
                provider_request.update(dispatch_status=prompt["status"], failure_phase=event.get("phase"),
                                        request_error=event.get("error"))
        if kind == "request_error":
            for row in state.setdefault("activity_events", []):
                if (row.get("kind") == "tool_preparation" and row.get("requestIndex") == request_index
                        and row.get("status") == "preparing"):
                    row["status"] = "interrupted"
                    row["timestamp"] = event.get("timestamp", time.time())
    elif kind == "tool_call_progress":
        activity_id = str(event.get("activityId") or
                          f"tool-call:{event.get('turnId', run.get('turn_id'))}:{int(event.get('request_index', 0))}:{int(event.get('call_index', 0))}")
        row = next((item for item in state.setdefault("activity_events", []) if item.get("id") == activity_id), None)
        progress = {"id": activity_id, "turnId": event.get("turnId", run.get("turn_id")),
                    "sessionId": state["session_id"], "workspace": event.get("workspace", state.get("workspace")),
                    "kind": "tool_preparation", "name": str(event.get("tool_name") or "model tool call"),
                    "status": "preparing", "provider": str(event.get("provider") or "unknown"),
                    "requestIndex": int(event.get("request_index", 0)), "callIndex": int(event.get("call_index", 0)),
                    "argumentCharacters": max(0, int(event.get("argument_characters", 0))),
                    "timestamp": event.get("timestamp", event.get("at", time.time()))}
        if row is None:
            state.setdefault("activity_events", []).append(progress)
        else:
            row.update(progress)
    elif kind == "tool_batch":
        request_index = event.get("request_index")
        for row in state.setdefault("activity_events", []):
            if (row.get("kind") == "tool_preparation" and row.get("requestIndex") == request_index
                    and row.get("status") == "preparing"):
                row["status"] = "assembled"
                row["timestamp"] = event.get("timestamp", time.time())
        run["tool_batch"] = {"assistant_message": copy.deepcopy(event.get("assistantMessage")),
                             "calls": copy.deepcopy(event.get("calls", [])),
                             "base_messages": copy.deepcopy(run.get("safe_messages", []))}
        run["completed_tool_results"] = {}
    elif kind == "tool_start":
        operation = {key: event.get(key) for key in ("operationId", "toolCallId", "name", "arguments", "startedAt")}
        operation["status"] = "running"
        active_operations = run.setdefault("active_operations", {})
        active_operations[str(event.get("operationId", ""))] = operation
        run["active_operation"] = copy.deepcopy(operation)
        activity = {"id": event.get("operationId"), "operationId": event.get("operationId"),
                    "turnId": event.get("turnId", run.get("turn_id")), "sessionId": state["session_id"],
                    "workspace": event.get("workspace", state.get("workspace")), "kind": "operation",
                    "name": event.get("name", "tool"), "arguments": copy.deepcopy(event.get("arguments", {})),
                    "status": "running", "startedAt": event.get("startedAt", time.time()), "output": {},
                    "result": "", "affectedFiles": []}
        state.setdefault("activity_events", []).append(activity)
    elif kind == "operation_output":
        row = next((item for item in state.setdefault("activity_events", [])
                    if item.get("operationId") == event.get("operationId")), None)
        if row:
            stream = str(event.get("stream", "stdout"))
            output = row.setdefault("output", {})
            output[stream] = str(output.get(stream, "")) + str(event.get("text", ""))
    elif kind == "tool_done":
        row = next((item for item in state.setdefault("activity_events", [])
                    if item.get("operationId") == event.get("operationId")), None)
        if row:
            row.update(status=event.get("status", "completed"), result=event.get("result", ""),
                       affectedFiles=copy.deepcopy(event.get("affectedFiles", [])),
                       completedAt=event.get("completedAt", time.time()))
        operation_id = str(event.get("operationId", ""))
        active_operations = run.setdefault("active_operations", {})
        previous_operation = copy.deepcopy(active_operations.pop(operation_id, None))
        current_active = run.get("active_operation")
        if previous_operation is None and isinstance(current_active, dict) and str(current_active.get("operationId", "")) == operation_id:
            previous_operation = copy.deepcopy(current_active)
        if isinstance(current_active, dict) and str(current_active.get("operationId", "")) == operation_id:
            run["active_operation"] = copy.deepcopy(next(reversed(active_operations.values()), None)) if active_operations else None
        if event.get("status") == "uncertain":
            uncertain = previous_operation if isinstance(previous_operation, dict) else {}
            uncertain.update({key: copy.deepcopy(event.get(key))
                              for key in ("operationId", "toolCallId", "name", "arguments", "result", "status", "affectedFiles", "completedAt")
                              if key in event})
            run["uncertain_operation"] = uncertain
            uncertain_operations = run.setdefault("uncertain_operations", [])
            if not isinstance(uncertain_operations, list):
                uncertain_operations = run["uncertain_operations"] = []
            uncertain_operations[:] = [item for item in uncertain_operations
                                       if not isinstance(item, dict) or str(item.get("operationId", "")) != operation_id]
            uncertain_operations.append(copy.deepcopy(uncertain))
        batch = run.get("tool_batch")
        if isinstance(batch, dict):
            results = run.setdefault("completed_tool_results", {})
            results[str(event.get("toolCallId", ""))] = str(event.get("result", ""))
            assistant, calls = batch.get("assistant_message"), batch.get("calls", [])
            if isinstance(assistant, dict) and isinstance(calls, list):
                safe = copy.deepcopy(batch.get("base_messages", run.get("safe_messages", [])))
                safe.append(assistant)
                for call in calls:
                    call_id = str(call.get("id", ""))
                    result = results.get(call_id, "Not executed: the process was interrupted before this operation started.")
                    safe.append({"role": "tool", "tool_name": str(call.get("name", "unknown_tool")), "content": result})
                run["safe_messages"] = safe
        checkpoint = state.get("task_checkpoint")
        if isinstance(checkpoint, dict):
            task = checkpoint.get("current", checkpoint)
            if isinstance(task, dict):
                operation_id = str(event.get("operationId", ""))
                operations = task.setdefault("operations", [])
                record = next((item for item in operations if item.get("operation_id") == operation_id), None)
                if record is None:
                    record = {"operation_id": operation_id}
                    operations.append(record)
                affected = copy.deepcopy(event.get("affectedFiles", record.get("affected_files", [])))
                record.update(name=str(event.get("name", "tool")), status=str(event.get("status", "unknown")),
                              affected_files=affected, result_ref=operation_id,
                              result_characters=len(str(event.get("result", ""))),
                              updated_at=event.get("completedAt", time.time()))
                changed = task.setdefault("changed_files", [])
                for path in affected:
                    if path and path not in changed and record["name"] in {"write_file", "edit_file", "apply_patch"} and record["status"] == "completed":
                        changed.append(path)
    elif kind == "plan":
        state["plan"] = copy.deepcopy(event.get("items", []))
        acceptance_criteria = event.get("acceptanceCriteria")
        criteria_included = isinstance(acceptance_criteria, list)
        if not criteria_included:
            acceptance_criteria = []
        checkpoint = state.get("task_checkpoint")
        if isinstance(checkpoint, dict):
            task = checkpoint.get("current", checkpoint)
            if isinstance(task, dict):
                if isinstance(event.get("items"), list):
                    task["plan"] = copy.deepcopy(event["items"])
                    pending = next((item for item in event["items"] if isinstance(item, dict)
                                    and str(item.get("status", "pending")).casefold() in {"pending", "in_progress", "in progress"}), None)
                    task["next_action"] = (str((pending or {}).get("title") or (pending or {}).get("text")
                                               or "Continue the active task plan.") if pending else "")
                if criteria_included:
                    task["acceptance_criteria"] = copy.deepcopy(acceptance_criteria)
                    task["acceptance_criteria_source"] = "agent" if event.get("source") != "workbench" else "awaiting_agent_refinement"
                record_plan(checkpoint, event.get("items", []), None, event.get("decisions"))
        plan_activity = {
            "id": event.get("actionId") or uuid.uuid4().hex, "turnId": event.get("turnId", run.get("turn_id")),
            "sessionId": state["session_id"], "workspace": event.get("workspace", state.get("workspace")),
            "kind": "plan", "status": "updated", "items": copy.deepcopy(event.get("items", [])),
            "timestamp": event.get("timestamp", time.time()),
        }
        if criteria_included:
            plan_activity["acceptanceCriteria"] = copy.deepcopy(acceptance_criteria)
        if isinstance(event.get("decisions"), list):
            plan_activity["decisions"] = copy.deepcopy(event["decisions"])
        state.setdefault("activity_events", []).append(plan_activity)
    elif kind == "context_compacted":
        state.setdefault("activity_events", []).append({
            "id": event.get("actionId") or uuid.uuid4().hex, "turnId": event.get("turnId", run.get("turn_id")),
            "sessionId": state["session_id"], "workspace": event.get("workspace", state.get("workspace")),
            "kind": "context", "status": "compacted", "omittedTurns": event.get("omittedTurns", 0),
            "omittedOperationGroups": event.get("omittedOperationGroups", 0),
            "retainedTurns": event.get("retainedTurns", 0), "configuredContext": event.get("configuredContext", state.get("context")),
            "inputBudget": event.get("inputBudget", 0), "reason": event.get("reason", ""),
            "checkpointIncluded": event.get("checkpointIncluded", False),
            "checkpointEstimate": event.get("checkpointEstimate", 0),
            "checkpointCompacted": event.get("checkpointCompacted", False),
            "checkpointOmissions": copy.deepcopy(event.get("checkpointOmissions", {})),
            "timestamp": event.get("timestamp", time.time()),
        })
    elif kind == "prompt_manifest":
        manifest = {key: copy.deepcopy(value) for key, value in event.items()
                    if key not in {"type", "activityId", "sessionId", "turnId", "workspace", "timestamp", "at", "_journal_event_id", "_journal_recorded_at_ns", "_journal_saved_to"}}
        state.setdefault("activity_events", []).append({
            "id": event.get("activityId") or event.get("_journal_event_id") or uuid.uuid4().hex,
            "turnId": event.get("turnId", run.get("turn_id")), "sessionId": state["session_id"],
            "workspace": event.get("workspace", state.get("workspace")), "kind": "prompt",
            "name": f"Model request {int(event.get('request_index', 0))}", "status": "prepared",
            "promptManifest": manifest, "timestamp": event.get("timestamp", time.time()),
        })
    elif kind == "generation_usage":
        request_index = event.get("request_index")
        prompt = next((item for item in reversed(state.setdefault("activity_events", []))
                       if item.get("kind") == "prompt"
                       and item.get("turnId") == event.get("turnId", run.get("turn_id"))
                       and isinstance(item.get("promptManifest"), dict)
                       and item["promptManifest"].get("request_index") == request_index), None)
        if prompt is not None:
            prompt["providerUsage"] = copy.deepcopy(event.get("usage", {}))
        state.setdefault("usage_events", []).append({"turn_id": event.get("turnId", run.get("turn_id")),
                                                     "session_id": state["session_id"],
                                                     "request_index": request_index,
                                                     "model": state.get("model"), "provider_id": state.get("provider_id"),
                                                     "settings": copy.deepcopy(run.get("settings", {})),
                                                     "usage": copy.deepcopy(event.get("usage", {})),
                                                     "first_token_seconds": event.get("first_token_seconds"),
                                                     "estimated_input_tokens": event.get("estimated_input_tokens"),
                                                     "timestamp": event.get("timestamp", time.time())})
    elif kind in {"complete", "generation_complete", "cancelled", "error", "stopped_after_operation"}:
        run["status"] = {"complete": "completed", "generation_complete": "completed",
                         "cancelled": "cancelled", "error": "failed", "stopped_after_operation": "stopped"}[kind]
        run["workflow_outcome"] = str(event.get("workflowOutcome", {
            "complete": "discussion", "generation_complete": "discussion", "cancelled": "cancelled",
            "error": "failed", "stopped_after_operation": "stopped",
        }[kind]))
        run["active_operation"] = None
        run["active_operations"] = {}
        if kind in {"complete", "generation_complete"}:
            run["verification"] = copy.deepcopy(event.get("verification", {"status": "unknown", "steps": []}))
        partial = {key: run.get(field, "") for key, field in (("content", "partial_content"), ("thinking", "partial_thinking"))
                   if isinstance(run.get(field), str) and run.get(field)}
        if partial:
            safe = copy.deepcopy(run.get("safe_messages", state.get("messages", [])))
            last = safe[-1] if safe and isinstance(safe[-1], dict) else {}
            if last.get("role") != "assistant" or any(last.get(key, "") != value for key, value in partial.items()):
                safe.append({"role": "assistant", **partial})
            run["safe_messages"] = safe
            state["messages"] = safe
        run["partial_content"] = ""
        run["partial_thinking"] = ""
        turn_id = run.get("turn_id")
        for turn in reversed(state.get("turns", [])):
            if isinstance(turn, dict) and turn.get("turn_id") == turn_id:
                turn["status"] = run["status"]
                turn["finished_at"] = event.get("timestamp", time.time())
                turn["transcript_saved"] = True
                break
        checkpoint = state.get("task_checkpoint")
        if isinstance(checkpoint, dict):
            task = checkpoint.get("current", checkpoint)
            if isinstance(task, dict):
                task["status"] = run["status"]
                task["workflow_outcome"] = run["workflow_outcome"]
                task["updated_at"] = event.get("timestamp", time.time())
                if kind in {"complete", "generation_complete"}:
                    task["verification"] = copy.deepcopy(run["verification"])
                    task["next_action"] = ""
                elif kind == "error":
                    blocker = str(event.get("error", "Run failed."))
                    blockers = task.setdefault("blockers", [])
                    if blocker not in blockers:
                        blockers.append(blocker)
                    task["next_action"] = "Review the saved checkpoint and determine the next safe action."
                else:
                    task["next_action"] = "Review the saved checkpoint and determine the next safe action."
        if kind == "error":
            state["last_error"] = {"message": str(event.get("error", "Run failed.")),
                                   "occurred_at": event.get("timestamp", time.time())}


class ProjectIdentity:
    filename = "workspace.json"

    def read(self, workspace: str | Path, create: bool = False) -> dict[str, Any] | None:
        root = Path(workspace).resolve(strict=create)
        path = root / ".agent-workbench" / self.filename
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(value, dict) and isinstance(value.get("workspace_id"), str):
                value.setdefault("track_sessions", False)
                return value
        except (OSError, json.JSONDecodeError):
            pass
        if not create:
            return None
        value = {"schema_version": 1, "workspace_id": str(uuid.uuid4()), "track_sessions": False}
        _atomic_json(path, value)
        return value


class MirroredSessionStore:
    """App-wide session library with a project-local mirror and explicit conflict resolution."""

    def __init__(self, app_data: Path | str):
        self.app_data = Path(app_data)
        self.app = SessionStore(self.app_data / "sessions")
        self.identity = ProjectIdentity()
        self._lock = threading.RLock()

    def _project_store(self, workspace: str | Path, create: bool = False) -> SessionStore:
        root = Path(workspace).resolve(strict=True)
        if not root.is_dir():
            raise ValueError("Project path must be a directory.")
        metadata = self.identity.read(root, create=create)
        if metadata is None:
            raise ValueError("Project identity is unavailable.")
        folder = root / ".agent-workbench" / "sessions"
        if create:
            self._set_git_exclude(root, not bool(metadata.get("track_sessions", False)))
            folder.mkdir(parents=True, exist_ok=True)
        elif not folder.is_dir():
            raise FileNotFoundError("This project has no mirrored sessions folder.")
        return SessionStore(folder)

    @staticmethod
    def _set_git_exclude(root: Path, ignored: bool) -> bool:
        try:
            result = subprocess.run(["git", "-C", str(root), "rev-parse", "--git-path", "info/exclude"],
                                    capture_output=True, text=True, timeout=5, check=True, shell=False)
            exclude = Path(result.stdout.strip())
            if not exclude.is_absolute():
                exclude = (root / exclude).resolve()
            current = exclude.read_text(encoding="utf-8") if exclude.exists() else ""
            start = "# Local Agent Workbench session data (managed)"
            block = f"{start}\n/.agent-workbench/\n# End Local Agent Workbench session data (managed)"
            lines = current.splitlines()
            if start in lines:
                begin = lines.index(start)
                end = next((i for i in range(begin + 1, len(lines)) if lines[i] == "# End Local Agent Workbench session data (managed)"), None)
                if end is not None:
                    del lines[begin:end + 1]
            if ignored:
                if lines and lines[-1] != "":
                    lines.append("")
                lines.extend(block.splitlines())
            exclude.parent.mkdir(parents=True, exist_ok=True)
            temporary = exclude.with_name(exclude.name + ".workbench-tmp")
            temporary.write_text("\n".join(lines).rstrip() + ("\n" if lines else ""), encoding="utf-8")
            os.replace(temporary, exclude)
            return True
        except (OSError, subprocess.SubprocessError):
            return False

    def set_track_sessions(self, workspace: str, track: bool) -> dict[str, Any]:
        root = Path(workspace).resolve(strict=True)
        metadata = self.identity.read(root, create=True) or {}
        metadata["track_sessions"] = bool(track)
        _atomic_json(root / ".agent-workbench" / self.identity.filename, metadata)
        ignored = self._set_git_exclude(root, not track)
        return {"workspace_id": metadata["workspace_id"], "track_sessions": bool(track), "git_exclude_updated": ignored}

    def create(self, workspace: str, model: str, context: int, options: dict | None = None) -> dict[str, Any]:
        root = Path(workspace).resolve(strict=True)
        metadata = self.identity.read(root, create=True) or {}
        state = self.app.create(str(root), model, context, options)
        state.update(workspace_id=metadata["workspace_id"], activity_events=[], plan=[], run_state=None,
                     task_checkpoint={}, usage_events=[], journal_cursor_ns=0, task_intent="auto")
        self._set_git_exclude(root, not bool(metadata.get("track_sessions", False)))
        return state

    def save(self, state: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            root = None
            metadata = None
            setup_error = None
            try:
                root = Path(state["workspace"]).resolve(strict=True)
                metadata = self.identity.read(root, create=True) or {}
                state["workspace_id"] = metadata["workspace_id"]
            except (OSError, ValueError, KeyError) as exc:
                setup_error = f"{type(exc).__name__}: {exc}"
            state["updated_at"] = time.time()
            app_error = None
            try:
                self.app.save(state)
            except (OSError, ValueError, TypeError) as exc:
                app_error = f"{type(exc).__name__}: {exc}"
            result = {"app_saved": app_error is None, "project_saved": False, "git_ignored": None,
                      "error": app_error or setup_error}
            if root is None or metadata is None:
                if app_error and setup_error:
                    result["error"] = f"{app_error}; {setup_error}"
                return result
            try:
                store = self._project_store(root, create=True)
                _atomic_json(store.root / (SessionStore._safe(state["session_id"]) + ".json"), state)
                result["project_saved"] = True
                result["git_ignored"] = not bool(metadata.get("track_sessions", False))
            except (OSError, ValueError, KeyError, TypeError) as exc:
                project_error = f"{type(exc).__name__}: {exc}"
                result["error"] = "; ".join(part for part in (app_error, project_error) if part)
            return result

    def append_events(self, session_id: str, workspace: str, events: list[dict[str, Any]]) -> dict[str, Any]:
        """Durably append compact run deltas to both mirrors before the next JSON snapshot."""
        safe_id = SessionStore._safe(session_id)
        rows = []
        app_rows = []
        project_rows = []
        cursor = 0
        for event in events:
            recorded_at_ns = int(event.get("_journal_recorded_at_ns", time.time_ns()))
            cursor = max(cursor, recorded_at_ns)
            event_id = str(event.get("_journal_event_id") or uuid.uuid4().hex)
            body = {key: copy.deepcopy(value) for key, value in event.items() if not key.startswith("_journal_")}
            row = {"event_id": event_id, "recorded_at_ns": recorded_at_ns, "event": body}
            rows.append(row)
            saved_to = event.get("_journal_saved_to", [])
            if "app" not in saved_to:
                app_rows.append(row)
            if "project" not in saved_to:
                project_rows.append(row)
        app_error = None
        project_error = None
        with self._lock:
            if app_rows:
                try:
                    _append_jsonl(self.app.root / (safe_id + ".events.jsonl"), app_rows)
                except (OSError, ValueError, TypeError) as exc:
                    app_error = f"{type(exc).__name__}: {exc}"
            if project_rows:
                try:
                    store = self._project_store(workspace, create=True)
                    _append_jsonl(store.root / (safe_id + ".events.jsonl"), project_rows)
                except (OSError, ValueError, KeyError, TypeError) as exc:
                    project_error = f"{type(exc).__name__}: {exc}"
        return {"app_saved": app_error is None, "project_saved": project_error is None,
                "cursor_ns": cursor, "error": "; ".join(part for part in (app_error, project_error) if part)}

    def _read_events(self, session_id: str, workspace: str | None, sources: set[str]) -> tuple[list[dict[str, Any]], list[str]]:
        paths = []
        if "app" in sources:
            paths.append(self.app.root / (SessionStore._safe(session_id) + ".events.jsonl"))
        if "project" in sources and workspace:
            try:
                paths.append(self._project_store(workspace).root / (SessionStore._safe(session_id) + ".events.jsonl"))
            except (OSError, ValueError, KeyError):
                pass
        found: dict[str, dict[str, Any]] = {}
        issues: list[str] = []
        for path in paths:
            try:
                with path.open("r", encoding="utf-8") as handle:
                    for line_number, line in enumerate(handle, start=1):
                        try:
                            row = json.loads(line)
                        except json.JSONDecodeError:
                            issues.append(f"{path.name}: unreadable journal record at line {line_number}; raw data was preserved.")
                            continue
                        if isinstance(row, dict) and isinstance(row.get("event_id"), str) and isinstance(row.get("event"), dict):
                            found.setdefault(row["event_id"], row)
                        else:
                            issues.append(f"{path.name}: invalid journal record at line {line_number}; raw data was preserved.")
            except FileNotFoundError:
                continue
            except OSError as exc:
                issues.append(f"{path.name}: could not read journal ({type(exc).__name__}); snapshot data was preserved.")
        return sorted(found.values(), key=lambda row: int(row.get("recorded_at_ns", 0))), issues

    def _replay_events(self, state: dict[str, Any], workspace: str | None, sources: set[str]) -> dict[str, Any]:
        cursor = int(state.get("journal_cursor_ns", 0) or 0)
        journal_rows, issues = self._read_events(state["session_id"], workspace, sources)
        if issues:
            existing = state.setdefault("recovery_issues", [])
            for issue in issues:
                if issue not in existing:
                    existing.append(issue)
        rows = [row for row in journal_rows
                if int(row.get("recorded_at_ns", 0)) > cursor]
        for row in rows:
            _replay_run_event(state, row["event"])
            cursor = max(cursor, int(row.get("recorded_at_ns", 0)))
        if rows:
            state["journal_cursor_ns"] = cursor
            state["updated_at"] = max(float(state.get("updated_at", 0) or 0), time.time())
        return state

    @staticmethod
    def _fingerprint(state: dict[str, Any]) -> str:
        value = copy.deepcopy(state)
        value.pop("updated_at", None)
        return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()

    def _versions(self, session_id: str, workspace: str | None = None) -> list[dict[str, Any]]:
        versions = []
        try:
            versions.append({"source": "app", "state": self.app.load(session_id)})
        except (OSError, ValueError, json.JSONDecodeError):
            pass
        if workspace:
            try:
                local = self._project_store(workspace).load(session_id)
                versions.append({"source": "project", "state": local})
            except (OSError, ValueError, json.JSONDecodeError):
                pass
        return versions

    def load(self, session_id: str, workspace: str | None = None, source: str | None = None) -> dict[str, Any]:
        versions = self._versions(session_id, workspace)
        if not versions:
            raise FileNotFoundError(f"Session not found in the app library or selected project: {session_id}")
        divergent = False
        if len(versions) == 2:
            same = self._fingerprint(versions[0]["state"]) == self._fingerprint(versions[1]["state"])
            divergent = not same
            recommended = max(versions, key=lambda row: row["state"].get("updated_at", 0))["source"]
            if not same and source is None:
                if workspace is None:
                    return max(versions, key=lambda row: row["state"].get("updated_at", 0))["state"]
                return {"conflict": True, "recommended_source": "project", "versions": [
                    {"source": row["source"], "updated_at": row["state"].get("updated_at")} for row in versions
                ]}
            if source is None:
                source = recommended
        selected = next((row for row in versions if row["source"] == source), None)
        if selected is None:
            selected = max(versions, key=lambda row: row["state"].get("updated_at", 0))
        state = selected["state"]
        if workspace is None:
            selected_sources = {selected["source"]} if divergent else {row["source"] for row in versions}
            return self._replay_events(state, state.get("workspace"), selected_sources)
        if workspace:
            root = Path(workspace).resolve(strict=True)
            metadata = self.identity.read(root, create=True) or {}
            if state.get("workspace_id") and state["workspace_id"] != metadata.get("workspace_id"):
                raise ValueError("This session belongs to a different project identity.")
            state["workspace"] = str(root)
            state["workspace_id"] = metadata["workspace_id"]
        selected_sources = {selected["source"]} if divergent else {row["source"] for row in versions}
        state = self._replay_events(state, str(root), selected_sources)
        return {"conflict": False, "source": selected["source"], "state": state}

    def list(self, workspace: str | None = None) -> list[dict[str, Any]]:
        root = Path(workspace).resolve() if workspace else None
        metadata = self.identity.read(root) if root else None
        candidates: dict[str, list[dict[str, Any]]] = {}
        for row in self.app.list():
            sid = row.get("session_id")
            if not sid:
                continue
            try:
                state = self.app.load(sid)
            except (OSError, ValueError, json.JSONDecodeError):
                continue
            matches = root is None or _normalize_path(state.get("workspace", "")) == _normalize_path(root) or bool(metadata and state.get("workspace_id") == metadata.get("workspace_id"))
            if matches:
                candidates.setdefault(sid, []).append({"source": "app", "state": state})
        if root and root.is_dir():
            try:
                local = self._project_store(root)
                for row in local.list():
                    sid = row.get("session_id")
                    if sid:
                        try:
                            candidates.setdefault(sid, []).append({"source": "project", "state": local.load(sid)})
                        except (OSError, ValueError, json.JSONDecodeError):
                            continue
            except (OSError, ValueError):
                pass
        rows = []
        for sid, versions in candidates.items():
            state = max(versions, key=lambda row: row["state"].get("updated_at", 0))["state"]
            conflict = len(versions) > 1 and self._fingerprint(versions[0]["state"]) != self._fingerprint(versions[1]["state"])
            if conflict:
                source = max(versions, key=lambda row: row["state"].get("updated_at", 0))["source"]
                state = self._replay_events(state, str(root) if root else state.get("workspace"), {source})
            else:
                sources = {row["source"] for row in versions}
                state = self._replay_events(state, str(root) if root else state.get("workspace"), sources)
            rows.append({key: state.get(key) for key in ("session_id", "workspace", "workspace_id", "model", "provider_id", "model_id", "updated_at")}
                        | {"sync_conflict": conflict, "recommended_source": "project" if conflict else ("project" if any(row["source"] == "project" for row in versions) else "app"), "sources": [row["source"] for row in versions],
                           "recovery_status": (state.get("run_state") or {}).get("status"), "uncertain_operation": (((state.get("run_state") or {}).get("uncertain_operation") or (state.get("run_state") or {}).get("active_operation") or {}).get("name")),
                           "recovery_issue_count": len(state.get("recovery_issues", []))})
        return sorted(rows, key=lambda row: row.get("updated_at") or 0, reverse=True)


class WorkspaceHistory:
    def __init__(self, app_data: Path | str):
        self.path = Path(app_data) / "workspaces.json"
        self.identity = ProjectIdentity()
        self._lock = threading.RLock()

    def _read(self) -> list[dict[str, Any]]:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            return data if isinstance(data, list) else []
        except (OSError, json.JSONDecodeError):
            return []

    def record(self, workspace: str, allow_missing: bool = False) -> dict[str, Any]:
        root = Path(workspace).resolve(strict=not allow_missing)
        if not allow_missing and not root.is_dir():
            raise ValueError("Workspace must be an existing directory.")
        identity = self.identity.read(root, create=True) if root.is_dir() else None
        key = _normalize_path(root)
        with self._lock:
            rows = self._read()
            row = next((item for item in rows if _normalize_path(item.get("path", "")) == key), None)
            if row is None and identity:
                row = next((item for item in rows if item.get("workspace_id") == identity["workspace_id"] and not Path(item.get("path", "")).is_dir()), None)
            if row is None:
                row = {"path": str(root), "workspace_id": identity.get("workspace_id") if identity else None, "pinned": False, "first_opened_at": time.time()}
                rows.append(row)
            row.update(path=str(root), workspace_id=identity.get("workspace_id") if identity else row.get("workspace_id"), last_opened_at=time.time())
            _atomic_json(self.path, rows)
            return dict(row)

    def list(self, query: str = "") -> list[dict[str, Any]]:
        needle = query.casefold().strip()
        rows = []
        for row in self._read():
            path = str(row.get("path", ""))
            if needle and needle not in path.casefold():
                continue
            rows.append({**row, "available": Path(path).is_dir()})
        return sorted(rows, key=lambda row: (not bool(row.get("pinned")), -(row.get("last_opened_at") or 0)))

    def set_pinned(self, workspace: str, pinned: bool) -> None:
        key = _normalize_path(workspace)
        with self._lock:
            rows = self._read()
            for row in rows:
                if _normalize_path(row.get("path", "")) == key:
                    row["pinned"] = bool(pinned)
                    _atomic_json(self.path, rows)
                    return
            raise KeyError(f"Workspace is not in history: {workspace}")

    def remove(self, workspace: str) -> None:
        key = _normalize_path(workspace)
        with self._lock:
            _atomic_json(self.path, [row for row in self._read() if _normalize_path(row.get("path", "")) != key])
