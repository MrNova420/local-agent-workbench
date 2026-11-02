from __future__ import annotations

import copy
import json
import os
import queue
import re
import runpy
import subprocess
import sys
import threading
import time
import traceback
import uuid
from pathlib import Path
from typing import Any


def _core_path() -> Path:
    configured = os.environ.get("LOCAL_AGENT_CORE_PATH")
    if configured:
        return Path(configured).resolve()
    return Path(__file__).resolve().parents[2] / "local-9b-dev-app"


CORE_PATH = _core_path()


def _verify_source_engine_pin() -> None:
    """Fail before importing engine code when source mode uses the wrong checkout."""
    if getattr(sys, "frozen", False):
        return
    app_root = Path(os.environ.get("LOCAL_AGENT_APP_ROOT", Path(__file__).resolve().parents[1])).resolve()
    verifier_path = app_root / "scripts" / "verify_core_checkout.py"
    try:
        verifier = runpy.run_path(str(verifier_path))
        verifier["verify_core_checkout"](app_root, CORE_PATH)
    except Exception as exc:
        sys.stdout.write(json.dumps({"type": "startup_error", "error": str(exc)}) + "\n")
        sys.stdout.flush()
        raise SystemExit(2) from exc


_verify_source_engine_pin()
if CORE_PATH.is_dir():
    sys.path.insert(0, str(CORE_PATH))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from desktop_engine import AgentEngine, OllamaRuntime, RequestCancelled, ToolRegistry, Workspace  # noqa: E402
from permission_policy import permission_rules_for_workspace, validate_permission_rules  # noqa: E402
from task_checkpoint import begin_task, finish_task, initial_task_plan, record_plan, record_user_update  # noqa: E402
from disposable_workspace import (  # noqa: E402
    apply_reviewed_changes,
    capture_manifest,
    create_disposable_workspace,
    managed_copy_path,
    review_changes,
)
from mcp_support import MCPManager  # noqa: E402
from project_knowledge import ProjectKnowledge  # noqa: E402
from project_view import preview_files  # noqa: E402
from project_diff import workspace_diff_text  # noqa: E402
from persistence import MirroredSessionStore, WorkspaceHistory  # noqa: E402
from telemetry import Telemetry  # noqa: E402
from turn_context import TurnContext, validate_selected_workspace  # noqa: E402
from ui_events import AgentEventRelay  # noqa: E402
from hf_catalog import HuggingFaceCatalog  # noqa: E402
from llama_cpp_runtime import LlamaCppServer  # noqa: E402
from providers.llama_cpp import LlamaCppProvider  # noqa: E402
from providers.ollama import OllamaProvider  # noqa: E402
from providers.registry import ProviderRegistry  # noqa: E402


APP_DATA = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local")) / "LocalAgentWorkbench"


def _validated_queued_prompts(state: dict[str, Any]) -> list[dict[str, Any]]:
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


def consume_queued_prompt(state: dict[str, Any], queued_prompt_id: str, prompt: str) -> dict[str, Any]:
    rows = _validated_queued_prompts(state)
    index = next((index for index, row in enumerate(rows) if row["id"] == queued_prompt_id), None)
    if index is None:
        raise ValueError("That queued prompt no longer exists.")
    item = rows[index]
    if item["prompt"] != prompt:
        raise ValueError("The queued prompt text does not match the selected queue entry.")
    state["queued_prompts"] = [row for row in rows if row["id"] != queued_prompt_id]
    return item


def _saved_operation_result(state: dict[str, Any], operation_id: str) -> str | None:
    """Read a completed result only from the session captured by the active turn."""
    for row in state.get("activity_events", []):
        if isinstance(row, dict) and row.get("operationId") == operation_id and isinstance(row.get("result"), str):
            return row["result"]
    return None


class RequestScopedOllama:
    """Translate a closed HTTP stream into cancellation when this request was cancelled."""

    def __init__(self, runtime: OllamaRuntime) -> None:
        self.runtime = runtime

    def cancel(self) -> None:
        self.runtime.cancel()

    def stream(self, state: dict[str, Any], messages: list[dict[str, Any]],
               cancel: threading.Event, emit: Any) -> dict[str, Any]:
        try:
            result = self.runtime.stream(state, messages, cancel, emit)
            usage = {
                key: result[key]
                for key in ("prompt_eval_count", "prompt_eval_cached_count", "prompt_eval_duration", "eval_count", "eval_duration", "load_duration")
                if isinstance(result.get(key), (int, float)) and not isinstance(result.get(key), bool)
            }
            if usage:
                event = {"type": "generation_usage", "usage": usage}
                request_index = state.get("request_index")
                if isinstance(request_index, int) and not isinstance(request_index, bool):
                    event["request_index"] = request_index
                emit(event)
            return result
        except Exception as exc:
            if cancel.is_set():
                raise RequestCancelled("Cancelled", partial_message=getattr(exc, "partial_message", None)) from exc
            raise


class AgentService:
    """New app's stdio service adapter around the shared local agent engine."""

    def __init__(self) -> None:
        self.sessions = MirroredSessionStore(APP_DATA)
        self.workspaces = WorkspaceHistory(APP_DATA)
        self.runtime = OllamaRuntime()
        self.telemetry = Telemetry()
        self.mcp = MCPManager(APP_DATA / "mcp.json")
        self.mcp.load()
        self.hf = HuggingFaceCatalog(APP_DATA / "models" / "huggingface")
        self.llama = LlamaCppServer(APP_DATA)
        self.model_sources_path = APP_DATA / "model-sources.json"
        self.llama_config_path = APP_DATA / "llama.json"
        self.permission_rules_path = APP_DATA / "permission-rules.json"
        self.gguf_models = self._load_json(self.model_sources_path, [])
        self.llama_config = self._load_json(self.llama_config_path, {})
        self.permission_rules_warning: str | None = None
        try:
            raw_permission_rules = json.loads(self.permission_rules_path.read_text(encoding="utf-8")) if self.permission_rules_path.exists() else []
            if isinstance(raw_permission_rules, list):
                legacy_external = [rule for rule in raw_permission_rules
                                   if isinstance(rule, dict) and rule.get("tool") == "external_directory"
                                   and not rule.get("workspace")]
                if legacy_external:
                    # Old external grants were app-global. Keep the original
                    # file intact, but never reapply those grants globally.
                    raw_permission_rules = [rule for rule in raw_permission_rules if rule not in legacy_external]
                    self.permission_rules_warning = (
                        f"{len(legacy_external)} legacy external-folder permission(s) had no owning project and were disabled. "
                        "Re-add them from the intended project in Tool permissions. The saved file remains unchanged until you save rules."
                    )
            self.permission_rules = validate_permission_rules(raw_permission_rules)
        except (OSError, json.JSONDecodeError, TypeError, ValueError) as exc:
            self.permission_rules = []
            self.permission_rules_warning = (f"Saved permission rules could not be loaded ({type(exc).__name__}). "
                                             "The original file was preserved and this run uses its selected approval mode without those overrides. "
                                             "Review Tool permissions in Settings before relying on saved overrides.")
        self.providers = ProviderRegistry([
            OllamaProvider(self.runtime),
            LlamaCppProvider(self.llama, lambda: self.gguf_models),
        ])
        self.hf_download_cancel = threading.Event()
        self.hf_download_thread: threading.Thread | None = None
        self.llama_load_cancel = threading.Event()
        self.llama_load_thread: threading.Thread | None = None
        self.ollama_import_cancel = threading.Event()
        self.ollama_import_proc: subprocess.Popen | None = None
        self.ollama_import_thread: threading.Thread | None = None
        self.emit_lock = threading.Lock()
        self.run_lock = threading.Lock()
        self.ollama_preload_lock = threading.Lock()
        self.ollama_preload_thread: threading.Thread | None = None
        self.active_lock = threading.RLock()
        self.active: dict[str, Any] | None = None
        self.output_ids: queue.SimpleQueue[str] = queue.SimpleQueue()

    def _save_active_session(self, controller: dict[str, Any]) -> dict[str, Any]:
        """Persist an immutable active-session snapshot without blocking its state lock."""
        with controller["checkpoint_lock"]:
            controller["session_snapshot_revision"] = int(controller.get("session_snapshot_revision", 0)) + 1
            revision = controller["session_snapshot_revision"]
            snapshot = copy.deepcopy(controller["session"])
        with controller.setdefault("session_save_lock", threading.Lock()):
            if revision < int(controller.get("session_saved_revision", 0)):
                return copy.deepcopy(controller.get("session_save_result", {
                    "app_saved": False, "project_saved": False,
                    "error": "A newer session snapshot superseded this checkpoint."}))
            saved = self.sessions.save(snapshot)
            controller["session_saved_revision"] = revision
            controller["session_save_result"] = copy.deepcopy(saved)
            return saved

    def _publish_run_event(self, controller: dict[str, Any], turn: TurnContext, event: dict[str, Any]) -> None:
        state = controller["session"]
        run_state = state.get("run_state")
        enriched = {**event, "sessionId": state["session_id"], "turnId": controller["turn_id"],
                    "workspace": str(turn.workspace), "timestamp": event.get("at", time.time())}
        event_kind = event.get("type")
        force_journal = event_kind in {"tool_start", "tool_done", "tool_batch", "plan", "context_compacted", "prompt_manifest", "inference_settings", "request_dispatched", "request_headers", "request_complete", "request_error", "steering_interrupted", "approval_request", "question_request", "question_answered", "generation_usage", "error", "cancelled", "stopped_after_operation", "generation_complete", "complete"}
        force_snapshot = event_kind in {"context_compacted", "request_error", "steering_interrupted", "approval_request", "question_request", "question_answered", "error", "cancelled", "stopped_after_operation", "generation_complete", "complete"}
        checkpoint_lock = controller["checkpoint_lock"]
        with checkpoint_lock:
            steering_interrupt = controller.get("steering_interrupt")
            if event_kind == "phase" and event.get("phase") == "waiting":
                controller["inference_active"] = True
                if (controller.get("pending_steers") and steering_interrupt is not None
                        and not controller.get("steering_persisting", False)):
                    steering_interrupt.set()
            elif event_kind in {"request_complete", "request_error"}:
                controller["inference_active"] = False
            if (event_kind == "request_error" and event.get("cancelled")
                    and steering_interrupt is not None and steering_interrupt.is_set()
                    and not (controller.get("cancel") and controller["cancel"].is_set())):
                event = {**event, "interrupted_by_steering": True}
                enriched["interrupted_by_steering"] = True
            if isinstance(run_state, dict):
                if event_kind == "phase":
                    run_state["phase"] = str(event.get("phase", "working"))
                elif event_kind == "request_dispatched":
                    run_state["phase"] = "waiting_response_headers"
                elif event_kind == "request_headers":
                    run_state["phase"] = "waiting"
                elif event_kind == "request_complete":
                    run_state["phase"] = "processing_response"
                elif event_kind == "request_error":
                    run_state["phase"] = ("steering_interrupted" if event.get("interrupted_by_steering")
                                           else "cancelled" if event.get("cancelled") else "failed")
                elif event_kind == "steering_interrupted":
                    run_state["phase"] = "applying_steering"
                if event.get("type") == "phase" and event.get("phase") == "waiting":
                    # Snapshot buffers describe one provider request, while the
                    # revision stays monotonic across the whole captured turn.
                    controller["live_content"] = ""
                    controller["live_thinking"] = ""
                    controller["text_revision"] = int(controller.get("text_revision", 0)) + 1
                    enriched["textRevision"] = controller["text_revision"]
                    safe_messages = run_state.get("safe_messages")
                    if not isinstance(safe_messages, list):
                        safe_messages = copy.deepcopy(state.get("messages", []))
                    prompt = str(run_state.get("prompt", ""))
                    if prompt and not run_state.get("safe_prompt_included"):
                        safe_messages.append({"role": "user", "content": prompt})
                        run_state["safe_prompt_included"] = True
                    partial = {key: run_state.get(field, "") for key, field in (("content", "partial_content"), ("thinking", "partial_thinking"))
                               if isinstance(run_state.get(field), str) and run_state.get(field)}
                    if partial:
                        last = safe_messages[-1] if safe_messages and isinstance(safe_messages[-1], dict) else {}
                        if last.get("role") != "assistant" or any(last.get(key, "") != value for key, value in partial.items()):
                            safe_messages.append({"role": "assistant", **partial})
                    run_state["safe_messages"] = safe_messages
                    run_state["tool_batch"] = None
                    run_state["completed_tool_results"] = {}
                    run_state["partial_content"] = ""
                    run_state["partial_thinking"] = ""
                    run_state["request_first_token_seconds"] = None
                elif event.get("type") == "phase" and event.get("phase") in {"reasoning", "generating"}:
                    if run_state.get("request_first_token_seconds") is None:
                        run_state["request_first_token_seconds"] = event.get("elapsed")
                elif event.get("type") == "inference_settings":
                    run_state["estimated_input_tokens"] = event.get("estimated_input_tokens")
                elif event.get("type") == "text":
                    run_state["partial_content"] = str(run_state.get("partial_content", "")) + str(event.get("text", ""))
                    controller["live_content"] = str(controller.get("live_content", "")) + str(event.get("text", ""))
                    controller["text_revision"] = int(controller.get("text_revision", 0)) + 1
                    enriched["textRevision"] = controller["text_revision"]
                elif event.get("type") == "thinking":
                    run_state["partial_thinking"] = str(run_state.get("partial_thinking", "")) + str(event.get("text", ""))
                    controller["live_thinking"] = str(controller.get("live_thinking", "")) + str(event.get("text", ""))
                    controller["text_revision"] = int(controller.get("text_revision", 0)) + 1
                    enriched["textRevision"] = controller["text_revision"]
                elif event.get("type") == "tool_batch":
                    run_state["tool_batch"] = {"assistant_message": copy.deepcopy(event.get("assistantMessage")),
                                                "calls": copy.deepcopy(event.get("calls", [])),
                                                "base_messages": copy.deepcopy(run_state.get("safe_messages", []))}
                    run_state["completed_tool_results"] = {}
                elif event.get("type") == "tool_start":
                    controller["current_operation_id"] = event.get("operationId")
                    if (str(event.get("name", "")) != "update_plan"
                            and run_state.get("first_operation_seconds") is None):
                        try:
                            operation_started = float(event.get("startedAt", time.time()))
                            run_started = float(run_state.get("started_at", operation_started))
                            run_state["first_operation_seconds"] = max(0.0, operation_started - run_started)
                            enriched["firstOperationSeconds"] = run_state["first_operation_seconds"]
                        except (TypeError, ValueError, OverflowError):
                            pass
                    operation = {key: event.get(key) for key in ("operationId", "toolCallId", "name", "arguments", "startedAt")}
                    operation["status"] = "running"
                    active_operations = run_state.setdefault("active_operations", {})
                    active_operations[str(event.get("operationId", ""))] = operation
                    run_state["active_operation"] = copy.deepcopy(operation)
                elif event.get("type") == "operation_output":
                    operation_id = str(event.get("operationId", ""))
                    row = next((item for item in state.setdefault("activity_events", []) if item.get("operationId") == operation_id), None)
                    if row:
                        stream = str(event.get("stream", "stdout"))
                        output = row.setdefault("output", {})
                        output[stream] = str(output.get(stream, "")) + str(event.get("text", ""))
                elif event.get("type") == "tool_done":
                    operation_id = str(event.get("operationId", ""))
                    if (str(event.get("name", "")) in {"write_file", "append_file", "edit_file", "apply_patch"}
                            and str(event.get("status", "")) == "completed"
                            and run_state.get("first_file_write_seconds") is None):
                        try:
                            write_completed = float(event.get("completedAt", time.time()))
                            run_started = float(run_state.get("started_at", write_completed))
                            run_state["first_file_write_seconds"] = max(0.0, write_completed - run_started)
                            enriched["firstFileWriteSeconds"] = run_state["first_file_write_seconds"]
                        except (TypeError, ValueError, OverflowError):
                            pass
                    active_operations = run_state.setdefault("active_operations", {})
                    previous_operation = copy.deepcopy(active_operations.pop(operation_id, None))
                    current_active = run_state.get("active_operation")
                    if previous_operation is None and isinstance(current_active, dict) and str(current_active.get("operationId", "")) == operation_id:
                        previous_operation = copy.deepcopy(current_active)
                    if controller.get("current_operation_id") == operation_id:
                        controller["current_operation_id"] = None
                    if isinstance(current_active, dict) and str(current_active.get("operationId", "")) == operation_id:
                        run_state["active_operation"] = copy.deepcopy(next(reversed(active_operations.values()), None)) if active_operations else None
                    if event.get("status") == "uncertain":
                        uncertain = previous_operation if isinstance(previous_operation, dict) else {}
                        uncertain.update({key: copy.deepcopy(event.get(key))
                                          for key in ("operationId", "toolCallId", "name", "arguments", "result", "status", "affectedFiles", "completedAt")
                                          if key in event})
                        run_state["uncertain_operation"] = uncertain
                        uncertain_operations = run_state.setdefault("uncertain_operations", [])
                        if not isinstance(uncertain_operations, list):
                            uncertain_operations = run_state["uncertain_operations"] = []
                        uncertain_operations[:] = [item for item in uncertain_operations
                                                    if not isinstance(item, dict) or str(item.get("operationId", "")) != operation_id]
                        uncertain_operations.append(copy.deepcopy(uncertain))
                    batch = run_state.get("tool_batch")
                    if isinstance(batch, dict):
                        results = run_state.setdefault("completed_tool_results", {})
                        results[str(event.get("toolCallId", ""))] = str(event.get("result", ""))
                        assistant = batch.get("assistant_message")
                        calls = batch.get("calls", [])
                        if isinstance(assistant, dict) and isinstance(calls, list):
                            # Rebuild from the batch's immutable starting point on each result.
                            # Using the previous checkpoint duplicates the batch for tool 2+.
                            checkpoint = copy.deepcopy(batch.get("base_messages", run_state.get("safe_messages", [])))
                            checkpoint.append(assistant)
                            for call in calls:
                                call_id = str(call.get("id", ""))
                                result = results.get(call_id, "Not executed: the process was interrupted before this operation started.")
                                checkpoint.append({"role": "tool", "tool_name": str(call.get("name", "unknown_tool")), "content": result})
                            run_state["safe_messages"] = checkpoint
                elif event.get("type") in {"complete", "generation_complete"}:
                    run_state["implementation_requested"] = bool(event.get("implementationRequested", False))
                    run_state["project_changed"] = bool(event.get("projectChanged", False))
                    run_state["action_denied"] = bool(event.get("actionDenied", False))
                    run_state["verification"] = copy.deepcopy(event.get("verification", {"status": "unknown", "steps": []}))
                    run_state["workflow_outcome"] = str(event.get("workflowOutcome", "discussion"))
                elif event.get("type") in {"error", "cancelled", "stopped_after_operation"}:
                    run_state["workflow_outcome"] = str(event.get("workflowOutcome") or
                        {"error": "failed", "cancelled": "cancelled",
                         "stopped_after_operation": "stopped"}[str(event.get("type"))])
                    if isinstance(event.get("verification"), dict):
                        run_state["verification"] = copy.deepcopy(event["verification"])
                    if event.get("type") == "error":
                        run_state["partial_response_saved"] = event.get("partial_response_saved") is True

            kind = event.get("type")
            activity: dict[str, Any] | None = None
            activity_updates: list[dict[str, Any]] = []
            activity_id = str(event.get("operationId") or event.get("actionId") or event.get("activityId") or event.get("questionId") or uuid.uuid4().hex)
            if kind == "tool_call_progress":
                activity_id = f"tool-call:{controller['turn_id']}:{int(event.get('request_index', 0))}:{int(event.get('call_index', 0))}"
                event["activityId"] = activity_id
            rows = state.setdefault("activity_events", [])
            if kind == "tool_call_progress":
                activity = next((item for item in rows if item.get("id") == activity_id), None)
                progress = {"id": activity_id, "turnId": controller["turn_id"], "sessionId": state["session_id"],
                            "workspace": str(turn.workspace), "kind": "tool_preparation",
                            "name": str(event.get("tool_name") or "model tool call"), "status": "preparing",
                            "provider": str(event.get("provider") or "unknown"),
                            "requestIndex": int(event.get("request_index", 0)),
                            "callIndex": int(event.get("call_index", 0)),
                            "argumentCharacters": max(0, int(event.get("argument_characters", 0))),
                            "timestamp": event.get("at", time.time())}
                if activity is None:
                    activity = progress
                    rows.append(activity)
                else:
                    activity.update(progress)
                enriched["activityId"] = activity_id
            elif kind == "tool_start":
                activity = {"id": activity_id, "operationId": activity_id, "turnId": controller["turn_id"],
                            "sessionId": state["session_id"], "workspace": str(turn.workspace), "kind": "operation",
                            "name": event.get("name", "tool"), "arguments": copy.deepcopy(event.get("arguments", {})),
                            "status": "running", "startedAt": event.get("startedAt", time.time()), "output": {}, "result": "", "affectedFiles": []}
                rows.append(activity)
            elif kind == "tool_progress":
                activity = next((item for item in rows if item.get("operationId") == event.get("operationId")), None)
                if activity and isinstance(event.get("progress"), dict):
                    activity["progress"] = copy.deepcopy(event["progress"])
                    activity["timestamp"] = event.get("timestamp", time.time())
            elif kind == "operation_output":
                activity = next((item for item in rows if item.get("operationId") == event.get("operationId")), None)
                if activity:
                    enriched["activityId"] = activity["id"]
                    enriched["activityPhase"] = "progress"
                    enriched["stream"] = event.get("stream", "stdout")
                    enriched["chunk"] = event.get("text", "")
            elif kind == "tool_done":
                activity = next((item for item in rows if item.get("operationId") == event.get("operationId")), None)
                if activity:
                    activity.update(status=event.get("status", "completed"), result=event.get("result", ""),
                                    affectedFiles=event.get("affectedFiles", []), completedAt=event.get("completedAt", time.time()))
            elif kind == "question_request":
                question_id = str(event.get("questionId") or activity_id)
                activity = {"id": question_id, "questionId": question_id, "operationId": event.get("operationId"),
                            "turnId": controller["turn_id"], "sessionId": state["session_id"],
                            "workspace": str(turn.workspace), "kind": "question",
                            "title": str(event.get("title") or "The agent needs input"),
                            "question": str(event.get("question", "")), "options": copy.deepcopy(event.get("options", [])),
                            "status": "awaiting_user", "timestamp": event.get("timestamp", time.time())}
                rows.append(activity)
            elif kind == "question_answered":
                activity = next((item for item in rows if item.get("kind") == "question"
                                 and item.get("questionId") == event.get("questionId")), None)
                if activity:
                    activity.update(status=str(event.get("status", "answered")), answer=str(event.get("answer", "")),
                                    completedAt=event.get("timestamp", time.time()))
            elif kind == "plan":
                source = "workbench" if event.get("source") == "workbench" else "agent"
                plan_items = copy.deepcopy(event.get("items", []))
                if isinstance(plan_items, list):
                    for item in plan_items:
                        if isinstance(item, dict):
                            item["source"] = source
                state["plan"] = plan_items
                acceptance_criteria = event.get("acceptanceCriteria", [])
                criteria_included = isinstance(acceptance_criteria, list)
                if not criteria_included:
                    acceptance_criteria = []
                checkpoint = state.get("task_checkpoint")
                if isinstance(checkpoint, dict):
                    record_plan(checkpoint, plan_items, acceptance_criteria if criteria_included and source == "agent" else None,
                                event.get("decisions"), event.get("taskMode"),
                                plan_source="agent" if source == "agent" else "workbench")
                activity = {"id": activity_id, "turnId": controller["turn_id"], "sessionId": state["session_id"],
                            "workspace": str(turn.workspace), "kind": "plan", "status": "updated", "source": source,
                            "items": copy.deepcopy(plan_items), "timestamp": time.time()}
                if event.get("taskMode") in {"discussion", "plan_only", "plan", "implement"}:
                    activity["taskMode"] = event["taskMode"]
                if criteria_included:
                    activity["acceptanceCriteria"] = copy.deepcopy(acceptance_criteria)
                if isinstance(event.get("decisions"), list):
                    activity["decisions"] = copy.deepcopy(event["decisions"])
                rows.append(activity)
            elif kind == "context_compacted":
                activity = {"id": activity_id, "turnId": controller["turn_id"], "sessionId": state["session_id"],
                            "workspace": str(turn.workspace), "kind": "context", "status": "compacted",
                            "omittedTurns": int(event.get("omittedTurns", 0)), "retainedTurns": int(event.get("retainedTurns", 0)),
                            "configuredContext": int(event.get("configuredContext", getattr(turn, "context", state.get("context", 0)))),
                            "inputBudget": int(event.get("inputBudget", 0)), "reason": event.get("reason", ""),
                            "omittedOperationGroups": int(event.get("omittedOperationGroups", 0)),
                            "checkpointIncluded": bool(event.get("checkpointIncluded", False)),
                            "checkpointEstimate": int(event.get("checkpointEstimate", 0)),
                            "checkpointCompacted": bool(event.get("checkpointCompacted", False)),
                            "checkpointOmissions": copy.deepcopy(event.get("checkpointOmissions", {})),
                            "timestamp": time.time()}
                rows.append(activity)
            elif kind == "prompt_manifest":
                manifest = {key: copy.deepcopy(value) for key, value in event.items()
                            if key not in {"type", "activityId", "sessionId", "turnId", "workspace", "timestamp", "at"}}
                activity = {"id": activity_id, "turnId": controller["turn_id"], "sessionId": state["session_id"],
                            "workspace": str(turn.workspace), "kind": "prompt", "name": f"Model request {int(event.get('request_index', 0))}",
                            "status": "prepared", "promptManifest": manifest, "timestamp": time.time()}
                rows.append(activity)
            elif kind == "inference_settings":
                request_index = event.get("request_index")
                activity = next((item for item in reversed(rows)
                                 if item.get("kind") == "prompt"
                                 and item.get("turnId") == controller["turn_id"]
                                 and isinstance(item.get("promptManifest"), dict)
                                 and item["promptManifest"].get("request_index") == request_index), None)
                if activity is not None:
                    activity["providerRequest"] = {
                        key: copy.deepcopy(event[key])
                        for key in ("provider", "request_api", "request_index", "model", "api_model", "stream", "tool_count", "tool_names", "deferred_tool_names", "requested_context",
                                    "runtime_context", "max_output_tokens", "reasoning_override", "runtime_reasoning", "reasoning_budget_tokens", "reasoning_budget_applied_by",
                                    "reasoning_field_sent", "keep_alive", "request_options", "additional_fields",
                                    "estimated_input_tokens", "input_estimate_method")
                        if key in event
                    }
                    activity["providerRequest"]["dispatch_status"] = "prepared"
            elif kind in {"request_dispatched", "request_headers", "request_complete", "request_error"}:
                request_index = event.get("request_index")
                activity = next((item for item in reversed(rows)
                                 if item.get("kind") == "prompt"
                                 and item.get("turnId") == controller["turn_id"]
                                 and isinstance(item.get("promptManifest"), dict)
                                 and item["promptManifest"].get("request_index") == request_index), None)
                if activity is not None:
                    provider_request = activity.setdefault("providerRequest", {"request_index": request_index})
                    if kind == "request_dispatched":
                        activity["status"] = "awaiting_response_headers"
                        provider_request["dispatch_status"] = "awaiting_response_headers"
                    elif kind == "request_headers":
                        activity["status"] = "response_headers_received"
                        provider_request.update(dispatch_status="response_headers_received",
                                                http_status=event.get("http_status"),
                                                http_reason=event.get("http_reason"),
                                                header_wait_seconds=event.get("header_wait_seconds"))
                    elif kind == "request_complete":
                        activity["status"] = "response_stream_ended"
                        provider_request.update(dispatch_status="response_stream_ended",
                                                provider_done=event.get("provider_done"),
                                                provider_done_reason=event.get("provider_done_reason"))
                    else:
                        activity["status"] = ("interrupted_by_steering" if event.get("interrupted_by_steering")
                                               else "cancelled_during_request" if event.get("cancelled")
                                               else "request_failed")
                        provider_request.update(dispatch_status=activity["status"],
                                                failure_phase=event.get("phase"), request_error=event.get("error"))
            elif kind == "generation_usage":
                request_index = event.get("request_index")
                activity = next((item for item in reversed(rows)
                                 if item.get("kind") == "prompt"
                                 and item.get("turnId") == controller["turn_id"]
                                 and isinstance(item.get("promptManifest"), dict)
                                 and item["promptManifest"].get("request_index") == request_index), None)
                if activity is not None:
                    activity["providerUsage"] = copy.deepcopy(event.get("usage", {}))
                state.setdefault("usage_events", []).append({
                    "turn_id": controller["turn_id"], "session_id": state["session_id"],
                    "request_index": request_index,
                    "model": state.get("model"), "provider_id": state.get("provider_id"),
                    "settings": copy.deepcopy(run_state.get("settings", {}) if isinstance(run_state, dict) else {}),
                    "usage": copy.deepcopy(event.get("usage", {})),
                    "first_token_seconds": run_state.get("request_first_token_seconds") if isinstance(run_state, dict) else None,
                    "estimated_input_tokens": run_state.get("estimated_input_tokens") if isinstance(run_state, dict) else None,
                    "timestamp": event.get("timestamp", time.time()),
                })
            elif kind == "error":
                activity = {"id": activity_id, "turnId": controller["turn_id"], "sessionId": state["session_id"],
                            "workspace": str(turn.workspace), "kind": "error",
                            "name": "Final response missing" if event.get("workflowOutcome") == "response_missing" else "Response truncated" if event.get("workflowOutcome") == "response_truncated" else "Run failed",
                            "status": "failed",
                            "result": str(event.get("error", "The run failed.")), "timestamp": time.time()}
                rows.append(activity)
            if kind in {"tool_batch", "request_error"}:
                request_index = event.get("request_index")
                next_status = "assembled" if kind == "tool_batch" else "interrupted"
                for row in rows:
                    if (row.get("kind") == "tool_preparation" and row.get("requestIndex") == request_index
                            and row.get("status") == "preparing"):
                        row["status"] = next_status
                        row["timestamp"] = event.get("at", time.time())
                        activity_updates.append(copy.deepcopy(row))
            if kind == "generation_usage":
                enriched["first_token_seconds"] = run_state.get("request_first_token_seconds") if isinstance(run_state, dict) else None
            if activity and kind == "tool_call_progress":
                # Keep transient token-level progress and the same resumable activity row.
                self.emit(enriched)
                self.emit({"type": "activity_event", "activity": copy.deepcopy(activity),
                           "sessionId": state["session_id"], "turnId": controller["turn_id"]})
            elif activity:
                if kind in {"inference_settings", "generation_usage", "request_dispatched", "request_headers", "request_complete", "request_error"}:
                    # Keep live settings/metrics/phase events and publish the same
                    # durable prompt row update to the activity feed.
                    self.emit(enriched)
                    self.emit({**enriched, "type": "activity_event", "activity": copy.deepcopy(activity)})
                else:
                    enriched["type"] = "activity_event"
                    enriched["activity"] = copy.deepcopy(activity) if kind != "operation_output" else None
                    self.emit(enriched)
            else:
                self.emit(enriched)
            for row in activity_updates:
                self.emit({"type": "activity_event", "activity": row,
                           "sessionId": state["session_id"], "turnId": controller["turn_id"]})

            if (activity and kind != "operation_output") or activity_updates:
                controller["activity_revision"] = int(controller.get("activity_revision", 0)) + 1

            pending = controller.setdefault("journal_pending", [])
            journal_event = {**event, "sessionId": state["session_id"], "turnId": controller["turn_id"],
                             "workspace": str(turn.workspace), "timestamp": event.get("at", time.time()),
                             "_journal_event_id": uuid.uuid4().hex, "_journal_recorded_at_ns": time.time_ns()}
            if kind == "tool_call_progress":
                # The provider event intentionally contains only tool identity and size,
                # never partial arguments. Keep this safe summary through recovery.
                journal_event = {key: value for key, value in journal_event.items()
                                 if key in {"type", "provider", "request_index", "call_index", "tool_name",
                                            "argument_characters", "at", "activityId", "sessionId", "turnId",
                                            "workspace", "timestamp", "_journal_event_id", "_journal_recorded_at_ns"}}
            if event.get("type") == "generation_usage" and isinstance(run_state, dict):
                journal_event["first_token_seconds"] = run_state.get("request_first_token_seconds")
            if (pending and pending[-1].get("type") == journal_event.get("type")
                    and journal_event.get("type") in {"text", "thinking", "tool_call_progress"}
                    and pending[-1].get("turnId") == journal_event.get("turnId")
                    and (journal_event.get("type") != "tool_call_progress" or
                         (pending[-1].get("request_index") == journal_event.get("request_index") and
                          pending[-1].get("call_index") == journal_event.get("call_index")))
                    and not pending[-1].get("_journal_saved_to")):
                if journal_event.get("type") == "tool_call_progress":
                    pending[-1].update({key: value for key, value in journal_event.items()
                                        if key not in {"_journal_event_id", "_journal_recorded_at_ns"}})
                    pending[-1]["_journal_event_id"] = journal_event["_journal_event_id"]
                    pending[-1]["_journal_recorded_at_ns"] = journal_event["_journal_recorded_at_ns"]
                else:
                    pending[-1]["text"] = str(pending[-1].get("text", "")) + str(journal_event.get("text", ""))
                    pending[-1]["timestamp"] = journal_event["timestamp"]
            elif (pending and pending[-1].get("type") == "operation_output"
                    and journal_event.get("type") == "operation_output"
                    and pending[-1].get("operationId") == journal_event.get("operationId")
                    and pending[-1].get("stream") == journal_event.get("stream")
                    and not pending[-1].get("_journal_saved_to")):
                pending[-1]["text"] = str(pending[-1].get("text", "")) + str(journal_event.get("text", ""))
                pending[-1]["timestamp"] = journal_event["timestamp"]
            else:
                pending.append(journal_event)

            now = time.monotonic()
            flush_journal = force_journal or now - controller["last_journal_flush"] >= 0.5
            if flush_journal and pending:
                journal_rows = pending[:]
                # Detach the batch before dropping the state lock. New events can
                # continue to update the live checkpoint while either mirror is slow.
                pending[:] = []
                journal_lock = controller.setdefault("journal_flush_lock", threading.Lock())
                checkpoint_lock.release()
                try:
                    with journal_lock:
                        journal_result = self.sessions.append_events(state["session_id"], str(state["workspace"]), journal_rows)
                except Exception as exc:
                    journal_result = {"app_saved": False, "project_saved": False,
                                      "error": f"{type(exc).__name__}: {exc}"}
                finally:
                    checkpoint_lock.acquire()
                controller["last_journal_flush"] = now
                for row in journal_rows:
                    saved_to = set(row.get("_journal_saved_to", []))
                    if journal_result["app_saved"]:
                        saved_to.add("app")
                    if journal_result["project_saved"]:
                        saved_to.add("project")
                    row["_journal_saved_to"] = sorted(saved_to)
                fully_mirrored = [row for row in journal_rows if {"app", "project"}.issubset(set(row.get("_journal_saved_to", [])))]
                pending.extend(row for row in journal_rows if row not in fully_mirrored)
                pending.sort(key=lambda row: int(row.get("_journal_recorded_at_ns", 0)))
                if fully_mirrored:
                    state["journal_cursor_ns"] = max(int(state.get("journal_cursor_ns", 0)),
                                                      max(int(row.get("_journal_recorded_at_ns", 0)) for row in fully_mirrored))
                if not (journal_result["app_saved"] and journal_result["project_saved"]):
                    if not controller.get("journal_error_reported"):
                        controller["journal_error_reported"] = True
                        self.emit({"type": "checkpoint_journal_error", "sessionId": state["session_id"],
                                   "appSaved": journal_result["app_saved"], "projectSaved": journal_result["project_saved"],
                                   "error": journal_result["error"] or "Run progress journal is unavailable."})
                else:
                    controller["journal_error_reported"] = False

            if force_snapshot or now - controller["last_checkpoint"] >= 8.0:
                controller["last_checkpoint"] = now
                checkpoint_lock.release()
                try:
                    saved = self._save_active_session(controller)
                finally:
                    checkpoint_lock.acquire()
                if not (saved["app_saved"] and saved["project_saved"]):
                    self.emit({"type": "session_mirror_error", "sessionId": state["session_id"], "appSaved": saved["app_saved"], "projectSaved": saved["project_saved"], "error": saved["error"] or "Session storage is unavailable."})

    def emit(self, event: dict[str, Any]) -> None:
        with self.emit_lock:
            sys.stdout.write(json.dumps({"type": "event", "event": event}, ensure_ascii=True) + "\n")
            sys.stdout.flush()

    def respond(self, request_id: str, ok: bool, data: Any = None, error: str | None = None) -> None:
        with self.emit_lock:
            payload = {"type": "response", "id": request_id, "ok": ok}
            if ok:
                payload["data"] = data
            else:
                payload["error"] = error or "Request failed."
            sys.stdout.write(json.dumps(payload, ensure_ascii=True) + "\n")
            sys.stdout.flush()

    def dispatch(self, message: dict[str, Any]) -> bool:
        request_id = str(message.get("id", ""))
        command = message.get("command")
        try:
            result = self.handle(command, message)
            self.respond(request_id, True, result)
            return command == "shutdown"
        except Exception as exc:
            self.respond(request_id, False, error=f"{type(exc).__name__}: {exc}")
            return False

    def _start_ollama_preload(self, message: dict[str, Any]) -> dict[str, Any]:
        model = str(message.get("model", "")).strip()
        context = message.get("context")
        keep_alive = str(message.get("keepAlive", "30m"))
        if not model or model.startswith("gguf::") or model not in self.runtime.models():
            raise ValueError("Choose an installed Ollama model to preload.")
        if not isinstance(context, int) or isinstance(context, bool) or context < 1024:
            raise ValueError("Preload context must be an integer of at least 1,024 tokens.")
        if not keep_alive:
            raise ValueError("Keep-alive must match the selected model setting.")
        if keep_alive == "0":
            reason = "Keep-alive is set to 0, so Ollama would unload the model immediately; the setting was left unchanged and preload was skipped."
            self.emit({"type": "ollama_preload_skipped", "model": model, "reason": reason})
            return {"accepted": False, "reason": reason}
        if self.active or self.run_lock.locked():
            raise RuntimeError("Cannot preload a model while a task is running.")
        if not self.ollama_preload_lock.acquire(blocking=False):
            raise RuntimeError("A model preload is already in progress.")

        keep_lock = False
        try:
            if self.run_lock.locked():
                raise RuntimeError("Cannot preload a model while a task is running.")
            loaded = self.runtime.loaded()
            target = next((row for row in loaded if row.get("name", row.get("model")) == model), None)
            if target is not None:
                loaded_context = target.get("context_length")
                if loaded_context == context:
                    self.emit({"type": "ollama_preload_skipped", "model": model, "reason": "The selected model is already loaded at the requested context.", "status": "already_loaded"})
                    return {"accepted": False, "status": "already_loaded"}
                reason = f"{model} is already loaded at {loaded_context or 'an unknown'} context; it was left untouched."
                self.emit({"type": "ollama_preload_skipped", "model": model, "reason": reason})
                return {"accepted": False, "reason": reason}
            if loaded:
                other = str(loaded[0].get("name", loaded[0].get("model", "another model")))
                reason = f"{other} is already loaded by Ollama; it was left running and the new model was not preloaded."
                self.emit({"type": "ollama_preload_skipped", "model": model, "reason": reason})
                return {"accepted": False, "reason": reason}

            def preload() -> None:
                try:
                    self.emit({"type": "ollama_preload_started", "model": model, "context": context})
                    started = time.monotonic()
                    response = self.runtime.preload(model, context, keep_alive)
                    elapsed_seconds = time.monotonic() - started
                    load_duration = response.get("load_duration") if isinstance(response, dict) else None
                    self.emit({"type": "ollama_preload_complete", "model": model, "context": context,
                               "elapsed_seconds": elapsed_seconds,
                               "load_duration_seconds": load_duration / 1_000_000_000 if isinstance(load_duration, (int, float)) and not isinstance(load_duration, bool) else None})
                except Exception as exc:
                    self.emit({"type": "ollama_preload_error", "model": model, "error": f"{type(exc).__name__}: {exc}"})
                finally:
                    self.ollama_preload_lock.release()

            thread = threading.Thread(target=preload, name="ollama-model-preload", daemon=True)
            self.ollama_preload_thread = thread
            thread.start()
            keep_lock = True
            return {"accepted": True, "model": model}
        finally:
            if not keep_lock:
                self.ollama_preload_lock.release()

    def _edit_session_queue(self, message: dict[str, Any], *, add_prompt: str | None = None,
                            remove_id: str | None = None) -> dict[str, Any]:
        session_id = str(message.get("sessionId", ""))
        if not session_id:
            raise ValueError("Choose the saved session for this follow-up prompt.")
        selected_workspace = validate_selected_workspace(True, str(message.get("workspace", "")))
        with self.active_lock:
            controller = self.active
        if controller is not None:
            state = controller["session"]
            if state.get("session_id") != session_id:
                raise RuntimeError("Follow-up prompts can only be queued for the active session while a run is in progress.")
            if Path(state["workspace"]).resolve(strict=True) != selected_workspace:
                raise ValueError("The selected session belongs to a different project.")
            with controller.setdefault("session_queue_lock", threading.Lock()):
                with controller["checkpoint_lock"]:
                    if not controller.get("accepting_queue", True):
                        raise RuntimeError("This run is finishing; try queuing the prompt again after it saves.")
                    prompts = _validated_queued_prompts(state)
                    state["queued_prompts"] = prompts
                    result = self._mutate_queue(prompts, add_prompt=add_prompt, remove_id=remove_id)
                    state["queued_prompts"] = result["queuedPrompts"]
                saved = self._save_active_session(controller)
        else:
            if not self.run_lock.acquire(blocking=False):
                raise RuntimeError("A run is starting; retry the follow-up after it is ready.")
            try:
                state = self._load_session_state(session_id)
                if Path(state["workspace"]).resolve(strict=True) != selected_workspace:
                    raise ValueError("The selected session belongs to a different project.")
                prompts = _validated_queued_prompts(state)
                result = self._mutate_queue(prompts, add_prompt=add_prompt, remove_id=remove_id)
                state["queued_prompts"] = result["queuedPrompts"]
                saved = self.sessions.save(state)
            finally:
                self.run_lock.release()
        if not (saved.get("app_saved") and saved.get("project_saved")):
            self.emit({"type": "session_mirror_error", "sessionId": session_id, "workspace": str(selected_workspace),
                       "appSaved": saved.get("app_saved", False), "projectSaved": saved.get("project_saved", False),
                       "error": saved.get("error") or "Queued prompt could not be mirrored to both session stores."})
        result["persistence"] = saved
        self.emit({"type": "session_queue_update", "sessionId": session_id, "workspace": str(selected_workspace),
                   "queuedPrompts": copy.deepcopy(result["queuedPrompts"])})
        return result

    def _accept_session_steer(self, message: dict[str, Any]) -> dict[str, Any]:
        prompt = message.get("prompt")
        clean = prompt.strip() if isinstance(prompt, str) else ""
        if not clean:
            raise ValueError("Steering input must contain text.")
        session_id = str(message.get("sessionId", ""))
        selected_workspace = validate_selected_workspace(True, str(message.get("workspace", "")))
        with self.active_lock:
            controller = self.active
        if controller is None:
            raise RuntimeError("There is no active task to steer. Use the composer to start a task or queue a follow-up.")
        state = controller["session"]
        if state.get("session_id") != session_id:
            raise RuntimeError("Steering is limited to the task's captured chat session.")
        if Path(state["workspace"]).resolve(strict=True) != selected_workspace:
            raise ValueError("The active task belongs to a different project.")
        update = {"id": uuid.uuid4().hex, "turn_id": controller["turn_id"], "instruction": clean,
                  "status": "pending", "created_at": time.time()}
        with controller.setdefault("steering_persist_lock", threading.Lock()):
            with controller["checkpoint_lock"]:
                if not controller.get("accepting_steering", False):
                    raise RuntimeError("This task is finishing; use the saved message as a follow-up after it completes.")
                checkpoint = state.setdefault("task_checkpoint", {})
                record_user_update(checkpoint, update)
                pending = controller.setdefault("pending_steers", [])
                pending.append(copy.deepcopy(update))
                run_state = state.get("run_state")
                if isinstance(run_state, dict):
                    run_state["pending_steers"] = copy.deepcopy(pending)
                controller["steering_persisting"] = True
            # The provider event loop must stay responsive while Windows retries
            # a locked mirror. The model thread waits at its safe boundary below.
            try:
                saved = self._save_active_session(controller)
            except Exception as exc:
                saved = {"app_saved": False, "project_saved": False,
                         "error": f"{type(exc).__name__}: {exc}"}
            with controller["checkpoint_lock"]:
                controller["steering_persisting"] = False
                condition = controller.get("steering_condition")
                if condition is not None:
                    condition.notify_all()
                if not (saved.get("app_saved") or saved.get("project_saved")):
                    controller["pending_steers"] = [row for row in controller.get("pending_steers", [])
                                                     if row.get("id") != update["id"]]
                    current = checkpoint.get("current") if isinstance(checkpoint, dict) else None
                    if isinstance(current, dict):
                        current["user_updates"] = [row for row in current.get("user_updates", [])
                                                    if not isinstance(row, dict) or row.get("id") != update["id"]]
                    if isinstance(run_state, dict):
                        run_state["pending_steers"] = copy.deepcopy(controller["pending_steers"])
                    raise RuntimeError(saved.get("error") or "Steering input could not be saved to either session mirror.")
                steering_interrupt = controller.get("steering_interrupt")
                interrupting = bool(controller.get("inference_active", False) and steering_interrupt is not None)
                if interrupting:
                    steering_interrupt.set()
                self.emit({"type": "steering_update", "status": "interrupting" if interrupting else "accepted", "updateId": update["id"],
                           "prompt": clean, "sessionId": session_id, "turnId": controller["turn_id"],
                           "workspace": str(selected_workspace), "createdAt": update["created_at"]})
                if not (saved.get("app_saved") and saved.get("project_saved")):
                    self.emit({"type": "session_mirror_error", "sessionId": session_id,
                               "appSaved": saved.get("app_saved", False), "projectSaved": saved.get("project_saved", False),
                               "error": saved.get("error") or "Steering was saved to only one session mirror."})
        return {"accepted": True, "updateId": update["id"], "status": "interrupting" if interrupting else "pending", "persistence": saved}

    def _load_session_state(self, session_id: str) -> dict[str, Any]:
        loaded = self.sessions.load(session_id)
        if loaded.get("conflict"):
            raise RuntimeError("The app and project session copies differ. Resolve the session conflict before changing or running this session.")
        if loaded.get("conflict") is False and isinstance(loaded.get("state"), dict):
            return loaded["state"]
        return loaded

    @staticmethod
    def _mutate_queue(prompts: list[dict[str, Any]], *, add_prompt: str | None,
                      remove_id: str | None) -> dict[str, Any]:
        updated = copy.deepcopy(prompts)
        if add_prompt is not None:
            clean = add_prompt.strip()
            if not clean:
                raise ValueError("Enter a follow-up prompt before queuing it.")
            item = {"id": uuid.uuid4().hex, "prompt": clean, "queued_at": time.time()}
            updated.append(item)
            return {"queued": item, "removed": False, "queuedPrompts": updated}
        removed = next((item for item in updated if item.get("id") == remove_id), None)
        if removed is not None:
            updated = [item for item in updated if item.get("id") != remove_id]
        return {"queued": None, "removed": removed is not None, "queuedPrompts": updated}

    def handle(self, command: str, message: dict[str, Any]) -> Any:
        if command == "ping":
            return {"status": "ready", "version": "0.1.0"}
        if command == "models":
            return self.runtime.models() + [row["id"] for row in self.gguf_models if isinstance(row, dict) and row.get("id")]
        if command == "model_catalog":
            try:
                ollama_models = self.runtime.models()
                ollama_error = None
            except Exception as exc:
                ollama_models = []
                ollama_error = f"{type(exc).__name__}: {exc}"
            gguf_models = []
            for row in self.providers.by_id("llama.cpp").models():
                try:
                    self._gguf_record(row.model_id)
                except (OSError, ValueError):
                    # A saved library entry whose GGUF was moved/deleted is not
                    # an installed local model and must not create a Home dot.
                    continue
                gguf_models.append({"id": row.model_id, "label": row.display_name, "provider": row.provider_id})
            return {"ollama": ollama_models,
                    "gguf": gguf_models,
                    "ollama_error": ollama_error}
        if command == "model_info":
            provider = self.providers.resolve(str(message["model"]))
            if provider.provider_id == "llama.cpp":
                source = self._gguf_record(str(message["model"]))
                status = self.llama.status()
                loaded = status.get("model") == source["path"]
                context = status.get("context") if loaded else source.get("context")
                reasoning = status.get("reasoning_capability") if loaded else None
                if not isinstance(reasoning, dict):
                    reasoning = {"support": "unknown", "default": None, "values": []}
                return {"model": message["model"], "provider": "llama.cpp", "context": None,
                        "effective_context": context, "context_limit_known": False, "max_output_tokens": None,
                        "capabilities": [], "tool_support": "unknown",
                        "reasoning": reasoning}
            info = self.runtime.model_info(str(message["model"]))
            details = info.get("model_info", {})
            tags = info.get("details", {}) if isinstance(info.get("details"), dict) else {}
            context = max(
                (value for key, value in details.items() if key.endswith(".context_length") and isinstance(value, int)),
                default=None,
            )
            raw_thinking = info.get("thinking")
            values = raw_thinking.get("values", []) if isinstance(raw_thinking, dict) else []
            values = [value for value in values if isinstance(value, (str, bool))] if isinstance(values, list) else []
            default = raw_thinking.get("default") if isinstance(raw_thinking, dict) else None
            if not isinstance(default, (str, bool)) or default not in values:
                default = None
            raw_capabilities = info.get("capabilities")
            capabilities = sorted({value for value in raw_capabilities if isinstance(value, str)}) if isinstance(raw_capabilities, list) else []
            tool_support = "supported" if "tools" in capabilities else "unsupported" if isinstance(raw_capabilities, list) else "unknown"
            support = "levels" if any(isinstance(value, str) for value in values) else "toggle" if True in values and False in values else "none" if values == [False] else "unknown"
            return {
                "model": message["model"], "context": context, "max_output_tokens": None,
                "family": tags.get("family") or next((value for key, value in details.items() if key.endswith(".family") and isinstance(value, str)), None),
                "parameter_size": tags.get("parameter_size") or next((value for key, value in details.items() if key.endswith(".parameter_size") and isinstance(value, str)), None),
                "quantization": tags.get("quantization_level") or next((value for key, value in details.items() if key.endswith(".quantization_level") and isinstance(value, str)), None),
                "reasoning": {"support": support, "default": default, "values": values},
                "capabilities": capabilities, "tool_support": tool_support,
                "provider": "ollama", "context_limit_known": context is not None,
            }
        if command == "ollama_preload":
            return self._start_ollama_preload(message)
        if command == "tool_catalog":
            # Capability discovery describes the full registered surface, not
            # the current run's plan-only access policy.
            registry = ToolRegistry(Workspace(Path.home(), "edit"), lambda *_: False)
            tools = [{"name": item["function"]["name"],
                      "description": item["function"].get("description", ""),
                      "source": "built-in",
                      "permission": "read-only" if item["function"]["name"] in {"list_files", "search_files", "read_file", "read_operation_result", "git_diff", "update_plan", "skill"} else "approval-controlled"}
                     for item in registry.schemas]
            tools.extend({"name": item["function"]["name"],
                          "description": item["function"].get("description", ""),
                          "source": "mcp", "permission": "per-operation approval"}
                         for item in self.mcp_tools)
            mcp_servers = []
            for name in sorted(self.mcp.servers):
                schema_warning_count = sum(1 for tool_name in self.mcp.schema_warnings if tool_name.startswith(f"mcp__{name}__"))
                schema_detail = (f"{schema_warning_count} tool schema(s) contain features the Workbench validator does not support; affected tool descriptions list them." if schema_warning_count else None)
                if name in self.mcp.errors:
                    mcp_servers.append({"name": name, "status": "error", "detail": self.mcp.errors[name]})
                elif name in self.mcp.clients:
                    mcp_servers.append({"name": name, "status": "connected", "detail": schema_detail})
                else:
                    mcp_servers.append({"name": name, "status": "configured", "detail": schema_detail})
            return {"tools": tools, "mcpServers": mcp_servers, "integrations": [
                {"name": "Project files and search", "status": "available", "detail": "Project-scoped list, search, read, create, exact edit, and patch tools."},
                {"name": "Commands and Git review", "status": "available", "detail": "Approved direct argv and PowerShell commands with streamed output and Git review. Commands run with host-user permissions; project root is not an OS sandbox."},
                {"name": "Plans and project skills", "status": "available", "detail": "Structured plan updates and on-demand project/user skills."},
                {"name": "Local and remote MCP tools", "status": "available", "detail": f"{len(self.mcp.servers)} server(s) configured. Supports local stdio and remote Streamable HTTP; each tool call uses the app approval flow. {len(self.mcp.schema_warnings)} discovered tool schema(s) report validation features the Workbench does not support."},
                {"name": "Browser automation", "status": "planned", "detail": "No first-party browser driver is connected; compatible MCP tools can extend the agent."},
                {"name": "LSP diagnostics and navigation", "status": "planned", "detail": "No language-server client is connected yet."},
                {"name": "Debugger", "status": "planned", "detail": "No debugger adapter is connected yet."},
            ]}
        if command == "permission_rules_get":
            return copy.deepcopy(self.permission_rules)
        if command == "permission_rules_set":
            if self.active:
                raise RuntimeError("Permission rules cannot change during an active run.")
            rules = validate_permission_rules(message.get("rules"))
            self._save_json(self.permission_rules_path, rules)
            self.permission_rules = rules
            self.permission_rules_warning = None
            return copy.deepcopy(self.permission_rules)
        if command == "hf_search":
            return self.hf.search(str(message.get("query", "")))
        if command == "hf_repo_files":
            return self.hf.repo_files(str(message["repo"]), str(message["revision"]))
        if command == "hf_download_start":
            return self._start_hf_download(message)
        if command == "hf_download_cancel":
            self.hf_download_cancel.set()
            return {"cancelled": True}
        if command == "gguf_register":
            return self._register_gguf(str(message.get("path", "")), message.get("source"))
        if command == "llama_binary_set":
            path = Path(str(message.get("path", ""))).resolve(strict=True)
            if not path.is_file() or path.suffix.casefold() != ".exe":
                raise ValueError("Select a llama.cpp Windows server executable (.exe).")
            self.llama_config = {"binary": str(path)}
            self._save_json(self.llama_config_path, self.llama_config)
            return {"binary": str(path)}
        if command == "llama_status":
            return {**self.llama.status(), "configured_binary": self.llama_config.get("binary")}
        if command == "llama_model_load":
            return self._start_llama_load(message)
        if command == "llama_model_cancel":
            self.llama_load_cancel.set()
            return {"cancelled": True}
        if command == "llama_model_stop":
            stopped = self.llama.stop()
            return {"stopped": stopped, "owned": False}
        if command == "ollama_safetensors_import":
            return self._start_safetensors_import(message)
        if command == "ollama_import_cancel":
            self.ollama_import_cancel.set()
            process = self.ollama_import_proc
            if process and process.poll() is None:
                process.terminate()
            return {"cancelled": True}
        if command == "system_snapshot":
            try:
                loaded = self.runtime.loaded()
                ollama_error = None
            except Exception as exc:
                loaded = []
                ollama_error = f"{type(exc).__name__}: {exc}"
            result = self.telemetry.snapshot(loaded)
            result["llama"] = self.llama.status(include_slot_metrics=True)
            result["ollama_error"] = ollama_error
            try:
                import psutil

                process = psutil.Process(os.getpid())
                result["service_rss_bytes"] = process.memory_info().rss
                result["service_cpu_percent"] = process.cpu_percent(interval=None)
            except Exception:
                result["service_rss_bytes"] = None
                result["service_cpu_percent"] = None
            return result
        if command == "workspace_files":
            root = validate_selected_workspace(True, message["workspace"])
            return preview_files(root, limit=2000)
        if command == "workspaces_list":
            return self.workspaces.list(str(message.get("query", "")))
        if command == "workspace_record":
            root = validate_selected_workspace(True, message["workspace"])
            return self.workspaces.record(str(root))
        if command == "workspace_remove":
            self.workspaces.remove(str(message["workspace"]))
            return {"removed": True}
        if command == "workspace_pin":
            self.workspaces.set_pinned(str(message["workspace"]), bool(message.get("pinned")))
            return {"pinned": bool(message.get("pinned"))}
        if command == "workspace_track_sessions":
            root = validate_selected_workspace(True, message["workspace"])
            return self.sessions.set_track_sessions(str(root), bool(message.get("track")))
        if command == "workspace_diff":
            root = validate_selected_workspace(True, message["workspace"])
            return {"text": workspace_diff_text(root)}
        if command == "sessions_list":
            workspace = message.get("workspace")
            return self.sessions.list(str(workspace) if workspace else None)
        if command == "session_live_snapshot":
            session_id = str(message.get("sessionId", ""))
            requested_workspace = str(message.get("workspace", ""))

            def inactive_snapshot(*, conflict: dict[str, Any] | None = None) -> dict[str, Any]:
                base: dict[str, Any] = {"active": False, "sessionId": session_id}
                if conflict is not None:
                    base["conflict"] = conflict
                    return base
                try:
                    root = Path(requested_workspace).resolve(strict=True)
                    loaded = self.sessions.load(session_id, str(root))
                except (OSError, RuntimeError, ValueError, FileNotFoundError):
                    return base
                base["workspace"] = str(root)
                if loaded.get("conflict"):
                    base["conflict"] = {"recommended_source": loaded.get("recommended_source"),
                                        "versions": copy.deepcopy(loaded.get("versions", []))}
                    return base
                saved = loaded.get("state")
                if not isinstance(saved, dict) or Path(str(saved.get("workspace", ""))).resolve() != root:
                    return base
                saved_run = saved.get("run_state")
                if not isinstance(saved_run, dict) or saved_run.get("status") == "running":
                    return base
                status = saved_run.get("status")
                if status not in {"completed", "failed", "cancelled", "stopped", "interrupted", "restored", "recovered"}:
                    return base
                criteria: list[str] = []
                for row in reversed(saved.get("activity_events", [])):
                    if isinstance(row, dict) and row.get("kind") == "plan" and isinstance(row.get("acceptanceCriteria"), list):
                        criteria = [item for item in row["acceptanceCriteria"] if isinstance(item, str)]
                        break
                base.update({
                    "sessionId": session_id, "workspace": str(root), "turnId": saved_run.get("turn_id"),
                    "activityRevision": len(saved.get("activity_events", [])), "textRevision": 0,
                    "runState": {key: copy.deepcopy(saved_run.get(key)) for key in (
                        "status", "started_at", "phase", "request_first_token_seconds", "workflow_outcome", "verification",
                    )},
                    "activities": copy.deepcopy(saved.get("activity_events", [])),
                    "plan": copy.deepcopy(saved.get("plan", [])), "acceptanceCriteria": criteria,
                    "savedTranscript": {"messages": copy.deepcopy(saved.get("messages", [])),
                                        "turns": copy.deepcopy(saved.get("turns", [])),
                                        "usage_events": copy.deepcopy(saved.get("usage_events", []))},
                })
                return base

            with self.active_lock:
                controller = self.active
            if not controller:
                return inactive_snapshot()
            state = controller.get("session")
            if not isinstance(state, dict) or session_id != str(state.get("session_id", "")):
                return inactive_snapshot()
            try:
                active_workspace = Path(controller.get("source", "")).resolve(strict=True)
                requested_root = Path(requested_workspace).resolve(strict=True) if requested_workspace else None
            except (OSError, RuntimeError):
                return inactive_snapshot()
            if requested_root is None or requested_root != active_workspace:
                return inactive_snapshot()
            with controller["checkpoint_lock"]:
                run_state = state.get("run_state")
                if not isinstance(run_state, dict):
                    return {"active": False, "sessionId": session_id}
                after_activity_revision = message.get("afterActivityRevision", 0)
                after_activity_revision = after_activity_revision if isinstance(after_activity_revision, int) and not isinstance(after_activity_revision, bool) else 0
                after_text_revision = message.get("afterTextRevision", 0)
                after_text_revision = after_text_revision if isinstance(after_text_revision, int) and not isinstance(after_text_revision, bool) else 0
                activity_revision = int(controller.get("activity_revision", 0))
                text_revision = int(controller.get("text_revision", 0))
                snapshot = {
                    "active": run_state.get("status") == "running",
                    "sessionId": session_id,
                    "turnId": controller.get("turn_id"),
                    "workspace": str(active_workspace),
                    "activityRevision": activity_revision,
                    "textRevision": text_revision,
                    "runState": {key: copy.deepcopy(run_state.get(key)) for key in (
                        "status", "started_at", "phase", "request_first_token_seconds", "first_operation_seconds", "first_file_write_seconds",
                        "estimated_input_tokens", "partial_content", "partial_thinking",
                        "active_operation", "active_operations", "uncertain_operation",
                    )},
                }
                if after_activity_revision < activity_revision:
                    snapshot["activities"] = copy.deepcopy(state.get("activity_events", []))
                    snapshot["plan"] = copy.deepcopy(state.get("plan", []))
                    snapshot["acceptanceCriteria"] = copy.deepcopy(state.get("acceptance_criteria", []))
                if after_text_revision < text_revision:
                    snapshot["liveAssistant"] = {
                        "content": str(controller.get("live_content", "")),
                        "thinking": str(controller.get("live_thinking", "")),
                    }
                return snapshot
        if command == "session_queue_prompt":
            prompt = message.get("prompt")
            if not isinstance(prompt, str):
                raise ValueError("Follow-up prompt must be text.")
            return self._edit_session_queue(message, add_prompt=prompt)
        if command == "session_steer":
            return self._accept_session_steer(message)
        if command == "session_queue_remove":
            return self._edit_session_queue(message, remove_id=str(message.get("queuedPromptId", "")))
        if command == "session_new":
            root = validate_selected_workspace(True, message["workspace"])
            model = str(message.get("model", "")).strip()
            context = int(message.get("context", 0))
            if not model or context < 1024:
                raise ValueError("Choose an installed model and an explicit context of at least 1,024 tokens.")
            state = self.sessions.create(str(root), model, context)
            mode = str(message.get("activityMode", "compact"))
            if mode not in {"compact", "sidebar", "inline"}:
                raise ValueError("Invalid activity display mode.")
            state["activity_mode"] = mode
            state["persistence"] = self.sessions.save(state)
            return state
        if command == "session_activity_mode":
            mode = str(message.get("activityMode", ""))
            if mode not in {"compact", "sidebar", "inline"}:
                raise ValueError("Invalid activity display mode.")
            state = self._load_session_state(str(message["sessionId"]))
            state["activity_mode"] = mode
            return self.sessions.save(state)
        if command == "session_run_settings":
            if self.active:
                raise RuntimeError("Run settings cannot be saved while a task is active.")
            settings = message.get("settings")
            if not isinstance(settings, dict):
                raise ValueError("Session run settings must be an object.")
            context = settings.get("context")
            max_tokens = settings.get("maxTokens")
            temperature = settings.get("temperature")
            if not isinstance(context, int) or isinstance(context, bool) or context < 1024:
                raise ValueError("Context must be at least 1,024 tokens.")
            if not isinstance(max_tokens, int) or isinstance(max_tokens, bool) or max_tokens < 1:
                raise ValueError("Maximum output tokens must be positive.")
            if not isinstance(temperature, (int, float)) or isinstance(temperature, bool) or not 0 <= float(temperature) <= 2:
                raise ValueError("Temperature must be between 0 and 2.")
            model = str(settings.get("model", "")).strip()
            provider = self.providers.resolve(model)
            if not any(item.model_id == model for item in provider.models()):
                raise ValueError("The selected model is no longer installed or registered.")
            access = str(settings.get("access", ""))
            approval_mode = str(settings.get("approvalMode", ""))
            harness_profile = str(settings.get("harnessProfile", ""))
            task_intent = str(settings.get("taskIntent", "auto"))
            skills_enabled = settings.get("skillsEnabled")
            skill_sources = settings.get("skillSources")
            if access not in {"copy", "plan", "ask", "edit"} or approval_mode not in {"per-action", "per-task", "per-session", "auto"}:
                raise ValueError("Invalid access or approval setting.")
            if harness_profile not in {"standard", "small-model"} or task_intent not in {"auto", "discuss", "plan", "implement"} or not isinstance(skills_enabled, bool):
                raise ValueError("Invalid workflow or skill setting.")
            if not isinstance(skill_sources, list) or not skill_sources or any(source not in {"project", "user"} for source in skill_sources):
                raise ValueError("Select at least one valid skill source.")
            reasoning = settings.get("reasoning")
            if reasoning is not None:
                if not isinstance(reasoning, (str, bool)):
                    raise ValueError("Invalid reasoning choice.")
                capabilities = self.handle("model_info", {"model": model}).get("reasoning", {})
                if reasoning not in capabilities.get("values", []):
                    raise ValueError("The selected model does not advertise that reasoning choice.")
            reasoning_budget_tokens = settings.get("reasoningBudgetTokens")
            if reasoning_budget_tokens is not None and (not isinstance(reasoning_budget_tokens, int) or isinstance(reasoning_budget_tokens, bool)
                    or reasoning_budget_tokens < 0 or reasoning_budget_tokens > 2_147_483_647):
                raise ValueError("Thinking budget must be an integer from 0 through 2,147,483,647 or unlimited.")
            state = self._load_session_state(str(message["sessionId"]))
            if approval_mode != "per-session":
                state["session_approval_granted"] = False
            state.update(model=model, model_id=model, provider_id=provider.provider_id, provider=provider.provider_id,
                         context=context, max_tokens=max_tokens, temperature=float(temperature), access=access,
                         approval_mode="per-action" if approval_mode == "auto" else approval_mode,
                         keep_alive=str(settings.get("keepAlive", "30m")), reasoning=reasoning,
                         reasoning_budget_tokens=reasoning_budget_tokens,
                         harness_profile=harness_profile, task_intent=task_intent, skills_enabled=skills_enabled,
                         skill_sources=list(dict.fromkeys(skill_sources)))
            state["persistence"] = self.sessions.save(state)
            return state
        if command == "session_harness_profile":
            profile = str(message.get("harnessProfile", "standard"))
            if profile not in {"standard", "small-model"}:
                raise ValueError("Invalid harness workflow profile.")
            state = self._load_session_state(str(message["sessionId"]))
            state["harness_profile"] = profile
            state["persistence"] = self.sessions.save(state)
            return state
        if command == "session_resume":
            selected_workspace = str(message.get("workspace", "")) or None
            if not selected_workspace:
                initial = self.sessions.load(str(message["sessionId"]))
                if initial.get("conflict"):
                    return initial
                selected_workspace = str(initial["workspace"])
            loaded = self.sessions.load(str(message["sessionId"]), selected_workspace, message.get("source"))
            if loaded.get("conflict"):
                return loaded
            state = loaded["state"]
            source = validate_selected_workspace(True, state["workspace"])
            if state.get("access") == "copy":
                expected = managed_copy_path(APP_DATA / "workspaces", state["session_id"], require_exists=True)
                saved = Path(state.get("working_workspace", "")).resolve(strict=True)
                if saved != expected or not isinstance(state.get("copy_manifest"), dict):
                    raise ValueError("Saved disposable workspace is missing or invalid; refusing to resume it.")
                state["working_workspace"] = str(saved)
            state["workspace"] = str(source)
            state["activity_events"] = state.get("activity_events", []) if isinstance(state.get("activity_events", []), list) else []
            state["plan"] = state.get("plan", []) if isinstance(state.get("plan", []), list) else []
            if state.get("recovery_issues"):
                state["recovery_review_required"] = True
                state["persistence"] = self.sessions.save(state)
            run_state = state.get("run_state")
            if isinstance(run_state, dict) and run_state.get("status") == "running":
                run_state["status"] = "interrupted"
                run_state["interrupted_at"] = time.time()
                active_operations = run_state.get("active_operations")
                if not isinstance(active_operations, dict):active_operations = {}
                if not active_operations and isinstance(run_state.get("active_operation"), dict):
                    active = run_state["active_operation"]
                    active_operations = {str(active.get("operationId", "legacy-active")): active}
                prior_uncertain = run_state.get("uncertain_operations")
                uncertain_operations = [copy.deepcopy(item) for item in prior_uncertain if isinstance(item, dict)] if isinstance(prior_uncertain, list) else []
                known_uncertain_ids = {str(item.get("operationId", "")) for item in uncertain_operations}
                completed_tool_results = run_state.setdefault("completed_tool_results", {})
                for active in active_operations.values():
                    if not isinstance(active, dict):continue
                    if active.get("name") == "ask_user":
                        active["status"] = "interrupted"
                        call_id = str(active.get("toolCallId", ""))
                        question = next((item for item in state["activity_events"]
                                         if item.get("kind") == "question"
                                         and item.get("operationId") == active.get("operationId")), None)
                        if call_id:
                            if question and question.get("status") == "answered":
                                completed_tool_results[call_id] = f"The user answered: {question.get('answer', '')}"
                            elif question and question.get("status") == "cancelled":
                                completed_tool_results[call_id] = "The user cancelled the run while this question was waiting. Ask again only if the answer is still needed."
                            else:
                                completed_tool_results[call_id] = "The app closed before this question received an answer. Ask again only if the answer is still needed."
                        for activity in state["activity_events"]:
                            if activity.get("operationId") == active.get("operationId"):
                                if activity.get("status") == "awaiting_user":
                                    activity["status"] = "interrupted"
                                elif activity.get("kind") == "operation" and activity.get("status") == "running":
                                    activity["status"] = "interrupted"
                        continue
                    active["status"] = "uncertain"
                    operation_id = str(active.get("operationId", ""))
                    if operation_id not in known_uncertain_ids:
                        uncertain_operations.append(copy.deepcopy(active))
                        known_uncertain_ids.add(operation_id)
                    for activity in state["activity_events"]:
                        if activity.get("operationId") == active.get("operationId"):
                            activity["status"] = "uncertain"
                run_state["uncertain_operations"] = uncertain_operations
                for activity in state["activity_events"]:
                    if activity.get("kind") == "question" and activity.get("status") == "awaiting_user":
                        activity["status"] = "interrupted"
                if uncertain_operations:run_state["uncertain_operation"] = copy.deepcopy(uncertain_operations[-1])
                run_state["active_operations"] = {}
                run_state["active_operation"] = None
                checkpoint = self._recovery_checkpoint(run_state)
                if checkpoint is not None:
                    run_state["safe_messages"] = checkpoint
                self.sessions.save(state)
            if message.get("source"):
                state["persistence"] = self.sessions.save(state)
            return state
        if command == "session_recover":
            action = str(message.get("action", ""))
            if action not in {"resume", "retry", "restore"}:
                raise ValueError("Choose resume, retry, or restore for this interrupted session.")
            state = self._load_session_state(str(message["sessionId"]))
            run_state = state.get("run_state")
            if not isinstance(run_state, dict) or run_state.get("status") != "interrupted":
                raise ValueError("This session has no interrupted run to recover.")
            if action == "restore":
                run_state["status"] = "restored"
                run_state["recovered_at"] = time.time()
                result = self.sessions.save(state)
                return {"state": state, "persistence": result, "action": action}
            safe_messages = run_state.get("safe_messages")
            if isinstance(safe_messages, list):
                state["messages"] = copy.deepcopy(safe_messages)
            uncertain_operations = run_state.get("uncertain_operations")
            if not isinstance(uncertain_operations, list):
                uncertain = run_state.get("uncertain_operation")
                uncertain_operations = [uncertain] if isinstance(uncertain, dict) else []
            if action == "retry":
                continuation = "Retry the interrupted task from its last safe checkpoint. The operation below may already have partially or fully completed; inspect the current workspace before repeating it and ask for approval as usual. Do not assume it failed."
            else:
                continuation = "Continue the interrupted task from its last safe checkpoint. Do not repeat any operation that already has a result. An in-flight operation may have partially completed; inspect its current effect before proposing a retry and ask for approval as usual."
            if uncertain_operations:
                continuation += "\n\nUncertain operation details (review each before repeating):\n" + json.dumps(uncertain_operations, ensure_ascii=False, indent=2)
            state["last_recovery"] = {"action": action, "interrupted_turn_id": run_state.get("turn_id"), "at": time.time()}
            run_state["status"] = "recovered"
            run_state["recovered_at"] = time.time()
            state["persistence"] = self.sessions.save(state)
            return {"state": state, "prompt": continuation, "action": action,
                    "uncertain_operation": uncertain_operations[-1] if uncertain_operations else None,
                    "uncertain_operations": copy.deepcopy(uncertain_operations)}
        if command == "mcp_config_get":
            return {"mcpServers": self.mcp.servers}
        if command == "mcp_config_set":
            config = message.get("config")
            if not isinstance(config, dict) or set(config) - {"mcpServers"} or not isinstance(config.get("mcpServers", {}), dict):
                raise ValueError("MCP configuration must be an object with an mcpServers map.")
            if self.active:
                raise RuntimeError("MCP settings cannot change during an active run.")
            self.mcp.shutdown()
            APP_DATA.mkdir(parents=True, exist_ok=True)
            path = APP_DATA / "mcp.json"
            path.write_text(json.dumps(config, indent=2), encoding="utf-8")
            self.mcp = MCPManager(path)
            self.mcp.load()
            return {"mcpServers": self.mcp.servers}
        if command == "run_start":
            options = message.get("options")
            if not isinstance(options, dict):
                raise ValueError("Run settings are missing.")
            if not self.ollama_preload_lock.acquire(blocking=False):
                raise RuntimeError("The selected model is still preloading.")
            try:
                if not self.run_lock.acquire(blocking=False):
                    raise RuntimeError("A task is already running.")
                try:
                    self._start_run(options)
                except Exception:
                    self.run_lock.release()
                    raise
            finally:
                self.ollama_preload_lock.release()
            return {"started": True}
        if command == "run_cancel":
            return {"cancelled": self.cancel()}
        if command == "run_stop_after_operation":
            with self.active_lock:
                controller = self.active
                if controller:
                    controller["stop_after_operation"] = True
                    engine = controller.get("engine")
                    if engine:
                        engine.finish_after_operation()
            return {"requested": controller is not None}
        if command == "approval_reply":
            return self.approval_reply(str(message["actionId"]), bool(message.get("approved")))
        if command == "question_reply":
            answer = message.get("answer")
            if not isinstance(answer, str) or not answer.strip():
                raise ValueError("Provide a non-empty answer to the active question.")
            return {"answered": self.question_reply(str(message["questionId"]), answer.strip())}
        if command == "copy_review":
            session = self._load_session_state(str(message["sessionId"]))
            if session.get("access") != "copy" or not session.get("copy_manifest"):
                raise ValueError("This session has no disposable-copy review to show.")
            source = Path(session["workspace"]).resolve(strict=True)
            working = managed_copy_path(APP_DATA / "workspaces", session["session_id"], require_exists=True)
            return review_changes(source, working, session["copy_manifest"])
        if command == "copy_apply":
            session = self._load_session_state(str(message["sessionId"]))
            source = Path(session["workspace"]).resolve(strict=True)
            working = managed_copy_path(APP_DATA / "workspaces", session["session_id"], require_exists=True)
            changes = review_changes(source, working, session.get("copy_manifest") or {})
            wanted = set(message.get("paths", []))
            selected = [change for change in changes if change["path"] in wanted]
            if len(selected) != len(wanted):
                raise ValueError("One or more reviewed paths are no longer available.")
            conflicts = [change["path"] for change in selected if change["conflict"]]
            if conflicts:
                raise ValueError("Source conflicts must be resolved before applying: " + ", ".join(conflicts))
            applied = apply_reviewed_changes(source, selected)
            session["copy_manifest"] = capture_manifest(source)
            self.sessions.save(session)
            return {"applied": applied}
        if command == "shutdown":
            self.cancel()
            self.hf_download_cancel.set()
            self.llama_load_cancel.set()
            self.ollama_import_cancel.set()
            thread = self.active.get("thread") if self.active else None
            if thread and thread is not threading.current_thread():
                thread.join(timeout=5)
            if self.ollama_import_proc and self.ollama_import_proc.poll() is None:
                self.ollama_import_proc.terminate()
            self.llama.shutdown()
            self.mcp.shutdown()
            return {"stopped": True}
        raise ValueError(f"Unknown command: {command}")

    @staticmethod
    def _load_json(path: Path, default: Any) -> Any:
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return copy.deepcopy(default)

    @staticmethod
    def _recovery_checkpoint(run_state: dict[str, Any]) -> list[dict[str, Any]] | None:
        batch = run_state.get("tool_batch")
        if not isinstance(batch, dict) or not isinstance(batch.get("assistant_message"), dict) or not isinstance(batch.get("calls"), list):
            return None
        base = batch.get("base_messages", run_state.get("safe_messages", []))
        if not isinstance(base, list):
            return None
        checkpoint = copy.deepcopy(base)
        checkpoint.append(copy.deepcopy(batch["assistant_message"]))
        results = run_state.get("completed_tool_results", {})
        results = results if isinstance(results, dict) else {}
        active_operations = run_state.get("active_operations")
        active_operations = active_operations if isinstance(active_operations, dict) else {}
        active = run_state.get("active_operation")
        if not active_operations and isinstance(active, dict):active_operations[str(active.get("operationId", "legacy-active"))] = active
        uncertain = run_state.get("uncertain_operations", [])
        uncertain = uncertain if isinstance(uncertain, list) else []
        active_call_ids = {str(operation.get("toolCallId")) for operation in [*active_operations.values(), *uncertain]
                           if isinstance(operation, dict) and operation.get("toolCallId") is not None}
        for call in batch["calls"]:
            if not isinstance(call, dict):
                continue
            call_id = str(call.get("id", ""))
            if call_id in results:
                content = str(results[call_id])
            elif call_id in active_call_ids:
                content = "Uncertain: this operation was interrupted and may have partially or fully completed. Inspect the workspace before retrying."
            else:
                content = "Not executed: the process was interrupted before this operation started."
            checkpoint.append({"role": "tool", "tool_name": str(call.get("name", "unknown_tool")), "content": content})
        return checkpoint

    @staticmethod
    def _save_json(path: Path, value: Any) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(path)

    def _gguf_record(self, model_id: str) -> dict[str, Any]:
        record = next((row for row in self.gguf_models if isinstance(row, dict) and row.get("id") == model_id), None)
        if not record:
            raise ValueError("This GGUF is not in the workbench model library.")
        path = Path(record.get("path", "")).resolve(strict=True)
        if not path.is_file() or path.suffix.casefold() != ".gguf":
            raise ValueError("The registered GGUF file is missing or invalid.")
        return {**record, "path": str(path)}

    def _register_gguf(self, path_text: str, source: Any = None) -> dict[str, Any]:
        path = Path(path_text).resolve(strict=True)
        if not path.is_file() or path.suffix.casefold() != ".gguf":
            raise ValueError("Select an existing .gguf model file.")
        existing = next((row for row in self.gguf_models if row.get("path") == str(path)), None)
        if existing:
            return existing
        record = {"id": "gguf::" + str(path), "path": str(path),
                  "label": path.name, "context": None,
                  "source": source if isinstance(source, dict) else {"kind": "local"}}
        self.gguf_models.append(record)
        self._save_json(self.model_sources_path, self.gguf_models)
        self.emit({"type": "model_registered", "model": record["id"], "label": record["label"], "provider": "llama.cpp"})
        return record

    def _start_hf_download(self, message: dict[str, Any]) -> dict[str, Any]:
        if self.hf_download_thread and self.hf_download_thread.is_alive():
            raise RuntimeError("A Hugging Face download is already running.")
        repo, revision = str(message.get("repo", "")), str(message.get("revision", ""))
        files = message.get("files")
        if not isinstance(files, list) or not files or len(files) > 500 or any(not isinstance(name, str) for name in files):
            raise ValueError("Select between 1 and 500 repository files to download.")
        self.hf_download_cancel = threading.Event()

        def work() -> None:
            try:
                for filename in files:
                    if self.hf_download_cancel.is_set():
                        raise InterruptedError("Download cancelled.")
                    saved = self.hf.download(repo, revision, filename, self.hf_download_cancel, self.emit)
                    if saved.suffix.casefold() == ".gguf":
                        self._register_gguf(str(saved), {"kind": "huggingface", "repo": repo, "revision": revision, "file": filename})
                model_dir = APP_DATA / "models" / "huggingface" / Path(repo) / revision
                self.emit({"type": "hf_download_job_complete", "repo": repo, "revision": revision, "directory": str(model_dir)})
            except InterruptedError:
                self.emit({"type": "hf_download_cancelled", "repo": repo})
            except Exception as exc:
                self.emit({"type": "hf_download_error", "error": f"{type(exc).__name__}: {exc}"})

        self.hf_download_thread = threading.Thread(target=work, name="hf-download", daemon=True)
        self.hf_download_thread.start()
        return {"started": True, "repo": repo, "revision": revision, "files": len(files)}

    def _start_llama_load(self, message: dict[str, Any]) -> dict[str, Any]:
        if self.run_lock.locked():
            raise RuntimeError("Wait until the current task finishes before loading a model.")
        if self.llama_load_thread and self.llama_load_thread.is_alive():
            raise RuntimeError("A GGUF model load is already running.")
        if not self.llama_config.get("binary"):
            raise ValueError("Select a llama.cpp server executable in Model Library settings first.")
        record = self._gguf_record(str(message.get("model", "")))
        context = int(message.get("context", 0))
        reasoning = message.get("reasoning")
        if context < 1024:
            raise ValueError("Choose a context of at least 1,024 tokens before loading.")
        self.llama_load_cancel = threading.Event()

        def work() -> None:
            try:
                self.llama.load(self.llama_config["binary"], record["path"], context, reasoning, self.llama_load_cancel, self.emit)
            except RequestCancelled:
                self.emit({"type": "llama_load_cancelled"})
            except Exception as exc:
                self.emit({"type": "llama_error", "error": f"{type(exc).__name__}: {exc}"})

        self.llama_load_thread = threading.Thread(target=work, name="llama-load", daemon=True)
        self.llama_load_thread.start()
        return {"started": True, "model": record["id"], "context": context}

    def _start_safetensors_import(self, message: dict[str, Any]) -> dict[str, Any]:
        if self.ollama_import_thread and self.ollama_import_thread.is_alive():
            raise RuntimeError("An Ollama model import is already running.")
        source = Path(str(message.get("directory", ""))).resolve(strict=True)
        name = str(message.get("name", "")).strip().lower()
        if not source.is_dir() or not any(source.rglob("*.safetensors")):
            raise ValueError("Choose a local directory containing Safetensors weight files.")
        if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,63}", name):
            raise ValueError("Model name must use 1–64 lowercase letters, digits, dots, underscores, or dashes.")
        self.ollama_import_cancel = threading.Event()
        workdir = APP_DATA / "imports" / uuid.uuid4().hex
        workdir.mkdir(parents=True, exist_ok=True)
        modelfile = workdir / "Modelfile"
        modelfile.write_text("FROM " + json.dumps(str(source)) + "\n", encoding="utf-8")

        def work() -> None:
            try:
                flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
                process = subprocess.Popen(["ollama", "create", name, "-f", str(modelfile)], cwd=workdir,
                                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                           encoding="utf-8", errors="replace", shell=False, creationflags=flags)
                self.ollama_import_proc = process
                if process.stdout:
                    for line in process.stdout:
                        self.emit({"type": "ollama_import_output", "text": line.rstrip()[:500]})
                code = process.wait()
                if self.ollama_import_cancel.is_set():
                    self.emit({"type": "ollama_import_cancelled", "name": name})
                elif code:
                    self.emit({"type": "ollama_import_error", "error": f"ollama create exited with code {code}.", "name": name})
                else:
                    self.emit({"type": "ollama_import_complete", "name": name})
            except OSError as exc:
                self.emit({"type": "ollama_import_error", "error": f"Could not start Ollama import: {exc}", "name": name})
            finally:
                self.ollama_import_proc = None

        self.ollama_import_thread = threading.Thread(target=work, name="ollama-safetensors-import", daemon=True)
        self.ollama_import_thread.start()
        return {"started": True, "name": name}

    def _start_run(self, options: dict[str, Any]) -> None:
        source = validate_selected_workspace(True, options.get("workspace", ""))
        prompt = str(options.get("prompt", "")).strip()
        model = str(options.get("model", "")).strip()
        if not prompt or not model:
            raise ValueError("A task and model are required.")
        requested_provider = options.get("providerId", options.get("provider_id"))
        provider = self.providers.resolve(model, str(requested_provider) if requested_provider else None)
        is_gguf = provider.provider_id == "llama.cpp"
        if is_gguf:
            record = self._gguf_record(model)
            llama_status = self.llama.status()
            if not llama_status["running"] or llama_status["model"] != record["path"]:
                raise ValueError("Load this GGUF from Model Library before starting a task.")
            if llama_status["context"] != int(options["context"]):
                raise ValueError(f"The loaded GGUF context is {llama_status['context']:,}; load it with the selected {int(options['context']):,} token context first.")
            if llama_status.get("reasoning") != options.get("reasoning"):
                raise ValueError("The loaded GGUF reasoning setting differs from this run. Load it with the selected reasoning setting first.")
        elif model not in self.runtime.models():
            raise ValueError(f"Model is not currently installed in Ollama: {model}")
        access = str(options.get("access", "ask"))
        approval_mode = str(options.get("approvalMode", "per-action"))
        if access not in {"copy", "plan", "ask", "edit"} or approval_mode not in {"per-action", "per-task", "per-session", "auto"}:
            raise ValueError("Invalid access or approval setting.")
        reasoning = options.get("reasoning")
        reasoning_budget_tokens = options.get("reasoningBudgetTokens")
        if reasoning_budget_tokens is not None and (not isinstance(reasoning_budget_tokens, int) or isinstance(reasoning_budget_tokens, bool)
                or reasoning_budget_tokens < 0 or reasoning_budget_tokens > 2_147_483_647):
            raise ValueError("Thinking budget must be an integer from 0 through 2,147,483,647 or unlimited.")
        harness_profile = str(options.get("harnessProfile", "standard"))
        if harness_profile not in {"standard", "small-model"}:
            raise ValueError("Invalid harness workflow profile.")
        task_intent = str(options.get("taskIntent", "auto"))
        if task_intent not in {"auto", "discuss", "plan", "implement"}:
            raise ValueError("Invalid task intent.")
        skills_enabled = options.get("skillsEnabled", True)
        skill_sources = options.get("skillSources", ["project", "user"])
        if not isinstance(skills_enabled, bool):
            raise ValueError("Skills enabled must be a boolean.")
        if not isinstance(skill_sources, list) or not skill_sources or any(source not in {"project", "user"} for source in skill_sources):
            raise ValueError("Select project skills, user skills, or both as skill sources.")
        skill_sources = list(dict.fromkeys(skill_sources))
        if reasoning is not None:
            if not isinstance(reasoning, (str, bool)):
                raise ValueError("Invalid reasoning choice.")
            capabilities = self.handle("model_info", {"model": model}).get("reasoning", {})
            if reasoning not in capabilities.get("values", []):
                raise ValueError("The selected model does not advertise that reasoning choice.")
        session_id = options.get("sessionId")
        state = self._load_session_state(str(session_id)) if session_id else self.sessions.create(str(source), model, int(options["context"]))
        if Path(state["workspace"]).resolve(strict=True) != source:
            raise ValueError("Selected session belongs to a different project. Open that project's workspace explicitly first.")
        queued_prompt_id = options.get("queuedPromptId")
        if queued_prompt_id is not None:
            if not isinstance(queued_prompt_id, str) or not queued_prompt_id:
                raise ValueError("Queued prompt identity is invalid.")
            consume_queued_prompt(state, queued_prompt_id, prompt)
        state.update(
            model=model, model_id=model, provider_id=provider.provider_id, provider=provider.provider_id,
            context=int(options["context"]), access=access,
            approval_mode="per-action" if approval_mode == "auto" else approval_mode, max_tokens=int(options["maxTokens"]),
            temperature=float(options["temperature"]), keep_alive=str(options.get("keepAlive", "30m")),
            reasoning=reasoning,
            reasoning_budget_tokens=reasoning_budget_tokens,
            harness_profile=harness_profile,
            task_intent=task_intent,
            skills_enabled=skills_enabled, skill_sources=skill_sources,
        )
        if approval_mode != "per-session":
            state["session_approval_granted"] = False
        if state["context"] < 1024 or state["max_tokens"] < 1 or not 0 <= state["temperature"] <= 2:
            raise ValueError("Context, output token, or temperature setting is outside the supported range.")
        working = source
        if access == "copy":
            destination = managed_copy_path(APP_DATA / "workspaces", state["session_id"])
            if not destination.exists():
                manifest = create_disposable_workspace(source, destination)
                state["copy_manifest"] = manifest
                state["working_workspace"] = str(destination)
            else:
                expected = managed_copy_path(APP_DATA / "workspaces", state["session_id"], require_exists=True)
                saved = Path(state.get("working_workspace", "")).resolve(strict=True)
                if saved != expected or not isinstance(state.get("copy_manifest"), dict):
                    raise ValueError("Disposable copy is missing a valid source snapshot; start a new session.")
            working = destination
        else:
            state["working_workspace"] = str(source)
            state.pop("copy_manifest", None)
        turn_id = uuid.uuid4().hex
        turn_started_at = time.time()
        # External-folder grants belong to the project selected when this run
        # starts. In copy mode, scope them to the original source project, not
        # to the disposable working copy.
        captured_permission_rules = permission_rules_for_workspace(copy.deepcopy(self.permission_rules), source)
        state.setdefault("activity_events", [])
        state.setdefault("plan", [])
        previous_checkpoint = state.get("task_checkpoint")
        previous_task = previous_checkpoint.get("current", previous_checkpoint) if isinstance(previous_checkpoint, dict) else None
        new_task = (not isinstance(previous_task, dict) or not previous_task.get("task_id")
                    or previous_task.get("status") in {"completed", "cancelled", "failed", "stopped"})
        if new_task:
            seed_intent = "plan" if access == "plan" and task_intent == "auto" else task_intent
            state["plan"] = initial_task_plan(prompt, seed_intent)
        state["task_checkpoint"] = begin_task(
            state.get("task_checkpoint"),
            prompt=prompt,
            turn_id=turn_id,
            workspace=str(working),
            settings={
                "model": model, "provider_id": provider.provider_id,
                "context": state["context"], "max_tokens": state["max_tokens"],
                "reasoning": reasoning, "temperature": state["temperature"],
                "reasoning_budget_tokens": reasoning_budget_tokens,
                "runtime_options": copy.deepcopy(state.get("runtime_options", {})),
                "harness_profile": harness_profile, "access": access,
                "approval_mode": approval_mode, "skills_enabled": skills_enabled,
                "skill_sources": skill_sources,
                "task_intent": task_intent,
                "requested_access": access,
                "effective_access": "plan" if task_intent in {"discuss", "plan"} else access,
                "permission_rules": copy.deepcopy(captured_permission_rules),
            },
            plan=copy.deepcopy(state.get("plan", [])),
        )
        turn_records = state.setdefault("turns", [])
        if not isinstance(turn_records, list):
            turn_records = state["turns"] = []
        prior_user_messages = sum(1 for row in state.get("messages", []) if isinstance(row, dict) and row.get("role") == "user")
        turn_records.append({"turn_id": turn_id, "prompt": prompt, "started_at": turn_started_at,
                             "workspace": str(working), "approval_mode": approval_mode, "status": "running",
                             "settings": {"model": model, "provider_id": provider.provider_id,
                                 "context": state["context"], "max_tokens": state["max_tokens"],
                                 "reasoning": reasoning, "temperature": state["temperature"],
                                 "reasoning_budget_tokens": reasoning_budget_tokens,
                                 "access": access, "effective_access": "plan" if task_intent in {"discuss", "plan"} else access,
                                 "approval_mode": approval_mode, "keep_alive": state.get("keep_alive", "30m"),
                                 "harness_profile": harness_profile, "task_intent": task_intent,
                                 "skills_enabled": skills_enabled, "skill_sources": list(skill_sources),
                                 "permission_rules": copy.deepcopy(captured_permission_rules)},
                             "transcript_saved": False, "prior_user_messages": prior_user_messages})
        state["run_state"] = {
            "status": "running", "turn_id": turn_id, "prompt": prompt, "started_at": turn_started_at,
            "safe_messages": [*copy.deepcopy(state.get("messages", [])), {"role": "user", "content": prompt}],
            "safe_prompt_included": True, "partial_content": "", "request_first_token_seconds": None,
            "partial_thinking": "", "active_operation": None, "active_operations": {}, "tool_batch": None,
            "completed_tool_results": {}, "workflow_outcome": None, "settings": {"model": model, "provider_id": provider.provider_id,
                "context": state["context"], "max_tokens": state["max_tokens"], "reasoning": reasoning,
                "reasoning_budget_tokens": reasoning_budget_tokens,
                "harness_profile": harness_profile, "skills_enabled": skills_enabled,
                "skill_sources": skill_sources, "task_intent": task_intent,
                "requested_access": access, "effective_access": "plan" if task_intent in {"discuss", "plan"} else access,
                "permission_rules": copy.deepcopy(captured_permission_rules)},
        }
        turn = TurnContext.capture(
            workspace=working, model=model, context=state["context"], access="plan" if task_intent in {"discuss", "plan"} else access,
            approval_mode=approval_mode, max_tokens=state["max_tokens"],
            harness_profile=harness_profile,
            skills_enabled=skills_enabled, skill_sources=skill_sources,
            temperature=state["temperature"], runtime_options=state.get("runtime_options", {}),
            prompt=prompt, session=state, mcp_tools=list(self.mcp_tools),
        )
        checkpoint_lock = threading.RLock()
        controller = {"cancel": threading.Event(), "engine": None, "pending": {}, "pending_questions": {}, "session": turn.session, "source": source, "working": working,
                     "turn_id": turn_id, "checkpoint_lock": checkpoint_lock, "last_checkpoint": time.monotonic(),
                     "last_journal_flush": time.monotonic(), "journal_pending": [], "current_operation_id": None,
                     "activity_revision": 0, "text_revision": 0, "live_content": "", "live_thinking": "",
                     "stop_after_operation": False, "accepting_queue": True, "accepting_steering": True,
                     "pending_steers": [], "steering_interrupt": threading.Event(), "steering_persisting": False,
                     "steering_persist_lock": threading.Lock(),
                     "steering_condition": threading.Condition(checkpoint_lock),
                     "inference_active": False, "approval_mode": approval_mode}
        with self.active_lock:
            self.active = controller
        saved = self.sessions.save(controller["session"])
        if not (saved["app_saved"] and saved["project_saved"]):
            self.emit({"type": "session_mirror_error", "sessionId": state["session_id"], "appSaved": saved["app_saved"], "projectSaved": saved["project_saved"], "error": saved["error"] or "Session storage is unavailable."})
        self.emit({"type": "run_started", "sessionId": state["session_id"], "turnId": turn_id})
        self.emit({"type": "session_queue_update", "sessionId": state["session_id"], "workspace": str(source),
                   "queuedPrompts": copy.deepcopy(controller["session"].get("queued_prompts", []))})
        if new_task:
            starter_event = {"type": "plan", "items": copy.deepcopy(state["plan"]),
                             "acceptanceCriteria": [], "source": "workbench"}
            starter_mode = {"discuss": "discussion", "plan": "plan", "implement": "implement"}.get(task_intent)
            if starter_mode:
                starter_event["taskMode"] = starter_mode
            self._publish_run_event(controller, turn, starter_event)
        thread = threading.Thread(target=self._run_turn, args=(controller, turn), name="agent-run", daemon=True)
        controller["thread"] = thread
        thread.start()

    def _run_turn(self, controller: dict[str, Any], turn: TurnContext) -> None:
        state = controller["session"]
        completion_event: dict[str, Any] | None = None

        def publish_engine_event(event: dict[str, Any]) -> None:
            nonlocal completion_event
            if event.get("type") == "generation_complete":
                completion_event = copy.deepcopy(event)
            self._publish_run_event(controller, turn, event)

        relay = AgentEventRelay(publish_engine_event)

        def update_turn_record(status: str, transcript_saved: bool | None = None) -> None:
            for record in reversed(state.get("turns", [])):
                if isinstance(record, dict) and record.get("turn_id") == controller["turn_id"]:
                    record["status"] = status
                    if status != "running":
                        record["finished_at"] = time.time()
                        record.pop("prior_user_messages", None)
                    if transcript_saved is not None:
                        record["transcript_saved"] = transcript_saved
                        record.pop("prior_user_messages", None)
                    break

        try:
            if controller["cancel"].is_set():
                update_turn_record("cancelled")
                finish_task(state.get("task_checkpoint", {}), "cancelled")
                run_state = state.get("run_state")
                if isinstance(run_state, dict):
                    run_state["status"] = "cancelled"
                    run_state["workflow_outcome"] = "cancelled"
                    run_state["active_operation"] = None
                    run_state["active_operations"] = {}
                    run_state["safe_messages"] = copy.deepcopy(state.get("messages", []))
                    run_state["partial_content"] = ""
                    run_state["partial_thinking"] = ""
                saved = self._save_active_session(controller)
                if not (saved["app_saved"] and saved["project_saved"]):
                    self.emit({"type": "session_mirror_error", "sessionId": state["session_id"], "appSaved": saved["app_saved"], "projectSaved": saved["project_saved"], "error": saved["error"] or "Session storage is unavailable."})
                self.emit({"type": "session_saved", "sessionId": state["session_id"], "workspace": state["workspace"]})
                self.emit({"type": "cancelled", "elapsed": 0, "sessionId": state["session_id"]})
                return
            read_only_access = turn.access == "plan"
            mcp_tools = [] if read_only_access else list(turn.mcp_tools)
            if not read_only_access and self.mcp.servers and not self.mcp.discovered:
                mcp_tools = self.mcp.run(self.mcp.discover(), cancel_event=controller["cancel"])
                self.mcp_tools = mcp_tools
                failed = ", ".join(self.mcp.errors.values())
                schema_warnings = len(self.mcp.schema_warnings)
                if schema_warnings:
                    self.emit({"type": "mcp_status", "text": f"MCP schema warning: {schema_warnings} tool schema(s) use unsupported validation features; review affected tool descriptions in Tool Catalog."})
                self.emit({"type": "mcp_status", "text": f"{len(mcp_tools)} MCP tools ready" + (f" · {failed}" if failed else "")})

            knowledge = ProjectKnowledge(turn.workspace)

            def approve(name: str, args: Any) -> bool:
                action_id = uuid.uuid4().hex
                condition = threading.Condition()
                result = {"done": False, "approved": False}
                with self.active_lock:
                    controller["pending"][action_id] = (condition, result)
                operation_id = controller.get("current_operation_id")
                with controller["checkpoint_lock"]:
                    rows = state.setdefault("activity_events", [])
                    activity = next((item for item in rows if item.get("operationId") == operation_id and item.get("kind") == "operation"), None)
                    if activity is None:
                        activity = {"id": str(operation_id or action_id), "operationId": operation_id, "turnId": controller["turn_id"],
                                    "sessionId": state["session_id"], "workspace": str(turn.workspace), "kind": "operation",
                                    "name": name, "arguments": copy.deepcopy(args), "status": "running", "timestamp": time.time(), "output": {}, "result": "", "affectedFiles": []}
                        rows.append(activity)
                    activity.update(approvalStatus="waiting", approvalMode=turn.approval_mode)
                saved = self._save_active_session(controller)
                if not (saved["app_saved"] and saved["project_saved"]):
                    self.emit({"type": "session_mirror_error", "sessionId": state["session_id"],
                               "appSaved": saved["app_saved"], "projectSaved": saved["project_saved"],
                               "error": saved["error"] or "Approval state could not be mirrored."})
                self.emit({"type": "activity_event", "activity": copy.deepcopy(activity), "activityPhase": "start", "sessionId": state["session_id"], "turnId": controller["turn_id"]})
                self.emit({"type": "approval_request", "actionId": action_id, "operationId": operation_id, "turnId": controller["turn_id"], "name": name,
                           "arguments": args, "workspace": str(turn.workspace),
                           "mode": turn.approval_mode, "sessionId": state["session_id"]})
                with condition:
                    while not result["done"] and not controller["cancel"].is_set():
                        condition.wait(0.25)
                with self.active_lock:
                    controller["pending"].pop(action_id, None)
                approval_status = "cancelled" if controller["cancel"].is_set() else "approved" if result["approved"] else "denied"
                with controller["checkpoint_lock"]:
                    activity["approvalStatus"] = approval_status
                    activity["completedAt"] = time.time()
                saved = self._save_active_session(controller)
                if not (saved["app_saved"] and saved["project_saved"]):
                    self.emit({"type": "session_mirror_error", "sessionId": state["session_id"],
                               "appSaved": saved["app_saved"], "projectSaved": saved["project_saved"],
                               "error": saved["error"] or "Approval decision could not be mirrored."})
                self.emit({"type": "activity_event", "activity": copy.deepcopy(activity), "sessionId": state["session_id"], "turnId": controller["turn_id"]})
                return bool(result["approved"])

            current_run_state = state.get("run_state")
            run_permission_rules = copy.deepcopy(current_run_state.get("settings", {}).get("permission_rules", [])) if isinstance(current_run_state, dict) else []

            def apply_steering(messages: list[dict[str, Any]], finishing: bool = False) -> bool:
                steering_condition = controller.setdefault(
                    "steering_condition", threading.Condition(controller["checkpoint_lock"]))
                with steering_condition:
                    while controller.get("steering_persisting") and not controller["cancel"].is_set():
                        steering_condition.wait(0.1)
                    if controller["cancel"].is_set():
                        return False
                    pending = copy.deepcopy(controller.get("pending_steers", []))
                    if not pending:
                        if finishing:
                            controller["accepting_steering"] = False
                        return False
                    checkpoint = state.setdefault("task_checkpoint", {})
                    prior_messages = len(messages)
                    for update in pending:
                        messages.append({"role": "user", "content": update["instruction"],
                                         "turn_id": controller["turn_id"], "steering_id": update["id"]})
                        record_user_update(checkpoint, {**update, "status": "delivered", "delivered_at": time.time()})
                    run_state = state.get("run_state")
                    if isinstance(run_state, dict):
                        run_state["safe_messages"] = copy.deepcopy(messages)
                        run_state["pending_steers"] = []
                try:
                    saved = self._save_active_session(controller)
                except Exception as exc:
                    saved = {"app_saved": False, "project_saved": False,
                             "error": f"{type(exc).__name__}: {exc}"}
                with steering_condition:
                    if not (saved.get("app_saved") or saved.get("project_saved")):
                        del messages[prior_messages:]
                        for update in pending:
                            record_user_update(checkpoint, {**update, "status": "pending"})
                        if isinstance(run_state, dict):
                            run_state["safe_messages"] = copy.deepcopy(messages)
                            run_state["pending_steers"] = copy.deepcopy(pending)
                        raise RuntimeError(saved.get("error") or "Steering could not be durably saved before delivery.")
                    controller["pending_steers"] = [
                        item for item in controller.get("pending_steers", [])
                        if item.get("id") not in {row.get("id") for row in pending}
                    ]
                    if isinstance(run_state, dict):
                        run_state["pending_steers"] = copy.deepcopy(controller["pending_steers"])
                    controller["steering_interrupt"].clear()
                    for update in pending:
                        self.emit({"type": "steering_update", "status": "delivered", "updateId": update["id"],
                                   "prompt": update["instruction"], "sessionId": state["session_id"],
                                   "turnId": controller["turn_id"], "workspace": str(turn.workspace),
                                   "deliveredAt": time.time()})
                    if not (saved.get("app_saved") and saved.get("project_saved")):
                        self.emit({"type": "session_mirror_error", "sessionId": state["session_id"],
                                   "appSaved": saved.get("app_saved", False), "projectSaved": saved.get("project_saved", False),
                                   "error": saved.get("error") or "Steering delivery was saved to only one session mirror."})
                    return True

            engine = AgentEngine(
                turn.workspace, turn.model, turn.context, turn.access, turn.approval_mode,
                relay, approve, runtime_options=turn.runtime_options,
                max_tokens=turn.max_tokens, temperature=turn.temperature,
                project_instructions=knowledge.instructions(), mcp_tools=mcp_tools,
                harness_profile=turn.harness_profile,
                mcp_call=lambda name, args: self.mcp.run(self.mcp.call(name, args), cancel_event=controller["cancel"]),
                task_checkpoint=state["task_checkpoint"],
                skills_enabled=turn.skills_enabled, skill_sources=turn.skill_sources,
                task_intent=str(turn.session.get("task_intent", "auto")),
                operation_result_lookup=lambda operation_id: _saved_operation_result(state, operation_id),
                permission_rules=run_permission_rules,
                permission_workspace_root=controller["source"],
                ask_user=lambda args: self._ask_user(controller, turn, args),
                session_approval_granted=bool(state.get("session_approval_granted", False)),
                steering_handler=apply_steering,
                steering_interrupt_event=controller["steering_interrupt"],
            )
            chosen_runtime = self.providers.runtime_for(turn.model, engine.runtime, state.get("provider_id"))
            engine.runtime = RequestScopedOllama(chosen_runtime)
            engine.state["reasoning"] = state.get("reasoning")
            engine.state["reasoning_budget_tokens"] = state.get("reasoning_budget_tokens")
            engine.state["keep_alive"] = state.get("keep_alive", "30m")
            controller["engine"] = engine
            if controller.get("stop_after_operation"):
                engine.finish_after_operation()
            if controller["cancel"].is_set():
                engine.cancel()
            messages = engine.run(turn.prompt, state.get("messages", []))
            state["messages"] = messages
            saved_user_count = sum(1 for row in messages if isinstance(row, dict) and row.get("role") == "user")
            prior_user_count = next((record.get("prior_user_messages", 0) for record in reversed(state.get("turns", []))
                                     if isinstance(record, dict) and record.get("turn_id") == controller["turn_id"]), 0)
            update_turn_record("running", saved_user_count > int(prior_user_count))
            terminal = relay.terminal_event
            successful_completion = completion_event
            with controller["checkpoint_lock"]:
                controller["accepting_queue"] = False
            run_state = state.get("run_state")
            if isinstance(run_state, dict):
                if terminal and terminal.get("type") in {"error", "cancelled", "stopped_after_operation"}:
                    partial = {key: run_state.get(field, "") for key, field in (("content", "partial_content"), ("thinking", "partial_thinking"))
                               if isinstance(run_state.get(field), str) and run_state.get(field)}
                    if partial:
                        last = messages[-1] if messages and isinstance(messages[-1], dict) else {}
                        if last.get("role") != "assistant" or any(last.get(key, "") != value for key, value in partial.items()):
                            messages = [*messages, {"role": "assistant", **partial}]
                            state["messages"] = messages
                has_success_event = successful_completion is not None
                run_state["status"] = (
                    "failed" if terminal and terminal.get("type") == "error"
                    else "cancelled" if terminal and terminal.get("type") == "cancelled"
                    else "stopped" if terminal and terminal.get("type") == "stopped_after_operation"
                    else "completed" if has_success_event else "failed"
                )
                run_state["workflow_outcome"] = (
                    str(terminal.get("workflowOutcome") or
                        {"error": "failed", "cancelled": "cancelled", "stopped_after_operation": "stopped"}.get(str(terminal.get("type")), "failed"))
                    if terminal else str(successful_completion.get("workflowOutcome", "discussion")) if successful_completion else "failed"
                )
                run_state["active_operation"] = None
                run_state["active_operations"] = {}
                run_state["safe_messages"] = copy.deepcopy(messages)
                run_state["partial_content"] = ""
                run_state["partial_thinking"] = ""
                update_turn_record(str(run_state["status"]))
            if terminal and terminal.get("type") == "error":
                state["last_error"] = {"message": str(terminal.get("error", "Run failed.")), "occurred_at": time.time()}
            elif not terminal and not completion_event:
                state["last_error"] = {"message": "The engine returned without a terminal completion event.", "occurred_at": time.time()}
                finish_task(state.get("task_checkpoint", {}), "failed",
                            blocker="The engine returned without a terminal completion event.")
            else:
                state.pop("last_error", None)
            state["working_workspace"] = str(turn.workspace)
            if turn.access == "copy":
                state["copy_manifest"] = state.get("copy_manifest") or capture_manifest(turn.workspace)
            saved = self._save_active_session(controller)
            if not (saved["app_saved"] and saved["project_saved"]):
                self.emit({"type": "session_mirror_error", "sessionId": state["session_id"], "appSaved": saved["app_saved"], "projectSaved": saved["project_saved"], "error": saved["error"] or "Session storage is unavailable."})
            self.emit({"type": "session_saved", "sessionId": state["session_id"], "workspace": state["workspace"]})
            if terminal:
                relay.emit_terminal_after_persist()
            elif completion_event:
                self.emit({**completion_event, "type": "complete", "sessionId": state["session_id"],
                           "turnId": controller["turn_id"], "workspace": str(turn.workspace), "timestamp": time.time()})
            else:
                self.emit({"type": "error", "error": "The engine returned without a terminal completion event.",
                           "sessionId": state["session_id"], "turnId": controller["turn_id"], "workspace": str(turn.workspace)})
        except Exception as exc:
            with controller["checkpoint_lock"]:
                controller["accepting_queue"] = False
            finish_task(state.get("task_checkpoint", {}), "failed", blocker=f"{type(exc).__name__}: {exc}")
            state["messages"] = state.get("messages", [])
            update_turn_record("failed")
            if isinstance(state.get("run_state"), dict):
                state["run_state"]["status"] = "failed"
                state["run_state"]["workflow_outcome"] = "failed"
                state["run_state"]["active_operation"] = None
                state["run_state"]["active_operations"] = {}
            state["last_error"] = {"message": f"{type(exc).__name__}: {exc}", "occurred_at": time.time()}
            try:
                self._save_active_session(controller)
                self.emit({"type": "session_saved", "sessionId": state["session_id"], "workspace": state["workspace"]})
            except Exception as save_error:
                self.emit({"type": "error", "error": f"{exc}; session save failed: {save_error}"})
            error_event = {"type": "error", "error": f"{type(exc).__name__}: {exc}", "sessionId": state["session_id"]}
            try:
                self._publish_run_event(controller, turn, error_event)
            except Exception:
                pass
            self.emit(error_event)
        finally:
            with controller.setdefault("steering_persist_lock", threading.Lock()):
                with controller["checkpoint_lock"]:
                    controller["accepting_steering"] = False
                    undelivered = copy.deepcopy(controller.get("pending_steers", []))
                    if undelivered:
                        for update in undelivered:
                            record_user_update(state.setdefault("task_checkpoint", {}),
                                               {**update, "status": "undelivered", "run_finished_at": time.time()})
                            self.emit({"type": "steering_update", "status": "undelivered", "updateId": update["id"],
                                       "prompt": update["instruction"], "sessionId": state["session_id"],
                                       "turnId": controller["turn_id"], "workspace": state["workspace"]})
                        run_state = state.get("run_state")
                        if isinstance(run_state, dict):
                            run_state["pending_steers"] = copy.deepcopy(undelivered)
                if undelivered:
                    saved = self._save_active_session(controller)
                    if not (saved.get("app_saved") and saved.get("project_saved")):
                        self.emit({"type": "session_mirror_error", "sessionId": state["session_id"],
                                   "appSaved": saved.get("app_saved", False), "projectSaved": saved.get("project_saved", False),
                                   "error": saved.get("error") or "Undelivered steering state could not be saved to both session mirrors."})
            with self.active_lock:
                if self.active is controller:
                    self.active = None
            if self.run_lock.locked():
                self.run_lock.release()
            self.emit({"type": "run_idle", "sessionId": state["session_id"], "workspace": state["workspace"]})

    @property
    def mcp_tools(self) -> list[dict[str, Any]]:
        if not hasattr(self, "_mcp_tools"):
            self._mcp_tools = []
        return self._mcp_tools

    @mcp_tools.setter
    def mcp_tools(self, value: list[dict[str, Any]]) -> None:
        self._mcp_tools = value

    def approval_reply(self, action_id: str, approved: bool) -> bool:
        with self.active_lock:
            controller = self.active
            pending = controller.get("pending", {}).get(action_id) if controller else None
        if not pending:
            return False
        if approved and controller and controller.get("approval_mode") == "per-session":
            state = controller["session"]
            with controller.setdefault("approval_persist_lock", threading.Lock()):
                with controller["checkpoint_lock"]:
                    previous = bool(state.get("session_approval_granted", False))
                    state["session_approval_granted"] = True
                saved = self._save_active_session(controller)
                if not (saved.get("app_saved") and saved.get("project_saved")):
                    with controller["checkpoint_lock"]:
                        state["session_approval_granted"] = previous
                    rollback = self._save_active_session(controller)
                    self.emit({"type": "session_mirror_error", "sessionId": state["session_id"],
                               "appSaved": saved.get("app_saved", False), "projectSaved": saved.get("project_saved", False),
                               "error": "; ".join(part for part in (saved.get("error"),
                                   "grant rollback saved to both mirrors" if rollback.get("app_saved") and rollback.get("project_saved")
                                   else f"grant rollback incomplete (app={rollback.get('app_saved')}, project={rollback.get('project_saved')})") if part)
                                   or "Session-wide approval could not be saved; the action was not approved."})
                    return False
                self.emit({"type": "session_approval_state", "sessionId": state["session_id"], "approved": True})
        condition, result = pending
        with condition:
            result.update(done=True, approved=approved)
            condition.notify_all()
        return True

    def question_reply(self, question_id: str, answer: str) -> bool:
        with self.active_lock:
            pending = self.active.get("pending_questions", {}).get(question_id) if self.active else None
        if not pending:
            return False
        condition, result = pending
        with condition:
            result.update(done=True, answer=answer)
            condition.notify_all()
        return True

    def _ask_user(self, controller: dict[str, Any], turn: TurnContext, args: dict[str, Any]) -> str:
        question_id = uuid.uuid4().hex
        condition = threading.Condition()
        result: dict[str, Any] = {"done": False, "answer": ""}
        with self.active_lock:
            controller.setdefault("pending_questions", {})[question_id] = (condition, result)
        self._publish_run_event(controller, turn, {
            "type": "question_request", "questionId": question_id,
            "operationId": controller.get("current_operation_id"),
            "title": str(args.get("title") or "The agent needs input"),
            "question": str(args.get("question", "")),
            "options": copy.deepcopy(args.get("options", [])),
        })
        with condition:
            while not result["done"] and not controller["cancel"].is_set():
                condition.wait(0.25)
        with self.active_lock:
            controller["pending_questions"].pop(question_id, None)
        cancelled = controller["cancel"].is_set()
        answer = "" if cancelled else str(result.get("answer", ""))
        self._publish_run_event(controller, turn, {
            "type": "question_answered", "questionId": question_id,
            "status": "cancelled" if cancelled else "answered", "answer": answer,
        })
        return "The user stopped the run while this question was waiting." if cancelled else answer

    def cancel(self) -> bool:
        with self.active_lock:
            controller = self.active
        if not controller:
            return False
        controller["cancel"].set()
        engine = controller.get("engine")
        if engine:
            engine.cancel()
        with self.active_lock:
            pending = list(controller.get("pending", {}).values())
            pending_questions = list(controller.get("pending_questions", {}).values())
        for condition, result in pending:
            with condition:
                result.update(done=True, approved=False)
                condition.notify_all()
        for condition, result in pending_questions:
            with condition:
                result["done"] = True
                condition.notify_all()
        return True


def main() -> None:
    service = AgentService()
    warnings = [service.permission_rules_warning] if service.permission_rules_warning else []
    sys.stdout.write(json.dumps({"type": "ready", "version": "0.1.0", "warnings": warnings}) + "\n")
    sys.stdout.flush()
    background_commands = {"session_steer", "session_queue_prompt", "session_queue_remove", "approval_reply"}
    request_threads: set[threading.Thread] = set()
    request_threads_lock = threading.Lock()

    def dispatch_background(message: dict[str, Any]) -> None:
        def run_request() -> None:
            try:
                service.dispatch(message)
            finally:
                with request_threads_lock:
                    request_threads.discard(threading.current_thread())

        thread = threading.Thread(target=run_request, name=f"sidecar-{message.get('command', 'request')}", daemon=True)
        with request_threads_lock:
            request_threads.add(thread)
        thread.start()

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
            if not isinstance(message, dict):
                raise ValueError("Request must be a JSON object.")
            if message.get("command") in background_commands:
                dispatch_background(message)
            elif service.dispatch(message):
                break
        except Exception as exc:
            service.respond("", False, error=f"{type(exc).__name__}: {exc}")
    service.cancel()
    while True:
        with request_threads_lock:
            active_requests = list(request_threads)
        if not active_requests:
            break
        for thread in active_requests:
            thread.join()
    service.mcp.shutdown()


if __name__ == "__main__":
    try:
        main()
    except BaseException:
        traceback.print_exc(file=sys.stderr)
        raise
