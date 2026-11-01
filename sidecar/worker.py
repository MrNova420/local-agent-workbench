from __future__ import annotations

import copy
import json
import os
import queue
import re
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
if CORE_PATH.is_dir():
    sys.path.insert(0, str(CORE_PATH))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from desktop_engine import AgentEngine, OllamaRuntime, RequestCancelled, ToolRegistry, Workspace  # noqa: E402
from permission_policy import validate_permission_rules  # noqa: E402
from task_checkpoint import begin_task, finish_task, initial_task_plan, record_plan  # noqa: E402
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

    def _publish_run_event(self, controller: dict[str, Any], turn: TurnContext, event: dict[str, Any]) -> None:
        state = controller["session"]
        run_state = state.get("run_state")
        enriched = {**event, "sessionId": state["session_id"], "turnId": controller["turn_id"],
                    "workspace": str(turn.workspace), "timestamp": event.get("at", time.time())}
        event_kind = event.get("type")
        force_journal = event_kind in {"tool_start", "tool_done", "tool_batch", "plan", "context_compacted", "prompt_manifest", "inference_settings", "request_dispatched", "request_headers", "request_complete", "request_error", "approval_request", "generation_usage", "error", "cancelled", "stopped_after_operation", "generation_complete", "complete"}
        force_snapshot = event_kind in {"context_compacted", "approval_request", "error", "cancelled", "stopped_after_operation", "generation_complete", "complete"}
        with controller["checkpoint_lock"]:
            if isinstance(run_state, dict):
                if event.get("type") == "phase" and event.get("phase") == "waiting":
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
                elif event.get("type") == "thinking":
                    run_state["partial_thinking"] = str(run_state.get("partial_thinking", "")) + str(event.get("text", ""))
                elif event.get("type") == "tool_batch":
                    run_state["tool_batch"] = {"assistant_message": copy.deepcopy(event.get("assistantMessage")),
                                                "calls": copy.deepcopy(event.get("calls", [])),
                                                "base_messages": copy.deepcopy(run_state.get("safe_messages", []))}
                    run_state["completed_tool_results"] = {}
                elif event.get("type") == "tool_start":
                    controller["current_operation_id"] = event.get("operationId")
                    run_state["active_operation"] = {key: event.get(key) for key in ("operationId", "toolCallId", "name", "arguments", "startedAt")}
                    run_state["active_operation"]["status"] = "running"
                elif event.get("type") == "operation_output":
                    operation_id = str(event.get("operationId", ""))
                    row = next((item for item in state.setdefault("activity_events", []) if item.get("operationId") == operation_id), None)
                    if row:
                        stream = str(event.get("stream", "stdout"))
                        output = row.setdefault("output", {})
                        output[stream] = str(output.get(stream, "")) + str(event.get("text", ""))
                elif event.get("type") == "tool_done":
                    controller["current_operation_id"] = None
                    previous_operation = copy.deepcopy(run_state.get("active_operation"))
                    run_state["active_operation"] = None
                    if event.get("status") == "uncertain":
                        uncertain = previous_operation if isinstance(previous_operation, dict) else {}
                        uncertain.update({key: copy.deepcopy(event.get(key))
                                          for key in ("operationId", "toolCallId", "name", "arguments", "result", "status", "affectedFiles", "completedAt")
                                          if key in event})
                        run_state["uncertain_operation"] = uncertain
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
                    run_state["workflow_outcome"] = {"error": "failed", "cancelled": "cancelled",
                                                     "stopped_after_operation": "stopped"}[str(event.get("type"))]

            kind = event.get("type")
            activity: dict[str, Any] | None = None
            activity_updates: list[dict[str, Any]] = []
            activity_id = str(event.get("operationId") or event.get("actionId") or event.get("activityId") or uuid.uuid4().hex)
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
                    record_plan(checkpoint, plan_items, acceptance_criteria if criteria_included and source == "agent" else None)
                activity = {"id": activity_id, "turnId": controller["turn_id"], "sessionId": state["session_id"],
                            "workspace": str(turn.workspace), "kind": "plan", "status": "updated", "source": source,
                            "items": copy.deepcopy(plan_items), "timestamp": time.time()}
                if criteria_included:
                    activity["acceptanceCriteria"] = copy.deepcopy(acceptance_criteria)
                rows.append(activity)
            elif kind == "context_compacted":
                activity = {"id": activity_id, "turnId": controller["turn_id"], "sessionId": state["session_id"],
                            "workspace": str(turn.workspace), "kind": "context", "status": "compacted",
                            "omittedTurns": int(event.get("omittedTurns", 0)), "retainedTurns": int(event.get("retainedTurns", 0)),
                            "configuredContext": int(event.get("configuredContext", turn.context)),
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
                        for key in ("provider", "request_api", "request_index", "model", "api_model", "stream", "tool_count", "requested_context",
                                    "runtime_context", "max_output_tokens", "reasoning_override", "runtime_reasoning",
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
                                                provider_done=event.get("provider_done"))
                    else:
                        activity["status"] = "cancelled_during_request" if event.get("cancelled") else "request_failed"
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
                            "workspace": str(turn.workspace), "kind": "error", "name": "Run failed", "status": "failed",
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
                journal_result = self.sessions.append_events(state["session_id"], str(state["workspace"]), journal_rows)
                controller["last_journal_flush"] = now
                for row in pending:
                    saved_to = set(row.get("_journal_saved_to", []))
                    if journal_result["app_saved"]:
                        saved_to.add("app")
                    if journal_result["project_saved"]:
                        saved_to.add("project")
                    row["_journal_saved_to"] = sorted(saved_to)
                fully_mirrored = [row for row in pending if {"app", "project"}.issubset(set(row.get("_journal_saved_to", [])))]
                pending[:] = [row for row in pending if row not in fully_mirrored]
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
                saved = self.sessions.save(state)
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
                context = status.get("context") if status.get("model") == source["path"] else source.get("context")
                return {"model": message["model"], "provider": "llama.cpp", "context": None,
                        "effective_context": context, "context_limit_known": False, "max_output_tokens": None,
                        "capabilities": [], "tool_support": "unknown",
                        "reasoning": {"support": "levels", "default": "auto",
                                      "values": [False, True, "minimal", "low", "medium", "high", "xhigh", "max"]}}
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
            registry = ToolRegistry(Workspace(Path.home(), "plan"), lambda *_: False)
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
            state = self.sessions.load(str(message["sessionId"]))
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
            if access not in {"copy", "plan", "ask", "edit"} or approval_mode not in {"per-action", "per-task", "auto"}:
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
            state = self.sessions.load(str(message["sessionId"]))
            state.update(model=model, model_id=model, provider_id=provider.provider_id, provider=provider.provider_id,
                         context=context, max_tokens=max_tokens, temperature=float(temperature), access=access,
                         approval_mode="per-action" if approval_mode == "auto" else approval_mode,
                         keep_alive=str(settings.get("keepAlive", "30m")), reasoning=reasoning,
                         harness_profile=harness_profile, task_intent=task_intent, skills_enabled=skills_enabled,
                         skill_sources=list(dict.fromkeys(skill_sources)))
            state["persistence"] = self.sessions.save(state)
            return state
        if command == "session_harness_profile":
            profile = str(message.get("harnessProfile", "standard"))
            if profile not in {"standard", "small-model"}:
                raise ValueError("Invalid harness workflow profile.")
            state = self.sessions.load(str(message["sessionId"]))
            state["harness_profile"] = profile
            state["persistence"] = self.sessions.save(state)
            return state
        if command == "session_resume":
            selected_workspace = str(message.get("workspace", "")) or None
            if not selected_workspace:
                selected_workspace = str(self.sessions.load(str(message["sessionId"]))["workspace"])
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
                active = run_state.get("active_operation")
                if isinstance(active, dict):
                    active["status"] = "uncertain"
                    run_state["uncertain_operation"] = copy.deepcopy(active)
                    for activity in state["activity_events"]:
                        if activity.get("operationId") == active.get("operationId"):
                            activity["status"] = "uncertain"
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
            state = self.sessions.load(str(message["sessionId"]))
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
            uncertain = run_state.get("uncertain_operation")
            if action == "retry":
                continuation = "Retry the interrupted task from its last safe checkpoint. The operation below may already have partially or fully completed; inspect the current workspace before repeating it and ask for approval as usual. Do not assume it failed."
            else:
                continuation = "Continue the interrupted task from its last safe checkpoint. Do not repeat any operation that already has a result. An in-flight operation may have partially completed; inspect its current effect before proposing a retry and ask for approval as usual."
            if uncertain:
                continuation += "\n\nUncertain operation details (review before repeating):\n" + json.dumps(uncertain, ensure_ascii=False, indent=2)
            state["last_recovery"] = {"action": action, "interrupted_turn_id": run_state.get("turn_id"), "at": time.time()}
            run_state["status"] = "recovered"
            run_state["recovered_at"] = time.time()
            state["persistence"] = self.sessions.save(state)
            return {"state": state, "prompt": continuation, "action": action, "uncertain_operation": uncertain}
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
        if command == "copy_review":
            session = self.sessions.load(str(message["sessionId"]))
            if session.get("access") != "copy" or not session.get("copy_manifest"):
                raise ValueError("This session has no disposable-copy review to show.")
            source = Path(session["workspace"]).resolve(strict=True)
            working = managed_copy_path(APP_DATA / "workspaces", session["session_id"], require_exists=True)
            return review_changes(source, working, session["copy_manifest"])
        if command == "copy_apply":
            session = self.sessions.load(str(message["sessionId"]))
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
        active = run_state.get("active_operation")
        active_call_id = active.get("toolCallId") if isinstance(active, dict) else None
        for call in batch["calls"]:
            if not isinstance(call, dict):
                continue
            call_id = str(call.get("id", ""))
            if call_id in results:
                content = str(results[call_id])
            elif active_call_id is not None and call_id == str(active_call_id):
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
        if access not in {"copy", "plan", "ask", "edit"} or approval_mode not in {"per-action", "per-task", "auto"}:
            raise ValueError("Invalid access or approval setting.")
        reasoning = options.get("reasoning")
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
        state = self.sessions.load(str(session_id)) if session_id else self.sessions.create(str(source), model, int(options["context"]))
        if Path(state["workspace"]).resolve(strict=True) != source:
            raise ValueError("Selected session belongs to a different project. Open that project's workspace explicitly first.")
        state.update(
            model=model, model_id=model, provider_id=provider.provider_id, provider=provider.provider_id,
            context=int(options["context"]), access=access,
            approval_mode="per-action" if approval_mode == "auto" else approval_mode, max_tokens=int(options["maxTokens"]),
            temperature=float(options["temperature"]), keep_alive=str(options.get("keepAlive", "30m")),
            reasoning=reasoning,
            harness_profile=harness_profile,
            task_intent=task_intent,
            skills_enabled=skills_enabled, skill_sources=skill_sources,
        )
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
        captured_permission_rules = copy.deepcopy(self.permission_rules)
        state.setdefault("activity_events", [])
        state.setdefault("plan", [])
        previous_checkpoint = state.get("task_checkpoint")
        previous_task = previous_checkpoint.get("current", previous_checkpoint) if isinstance(previous_checkpoint, dict) else None
        new_task = not isinstance(previous_task, dict) or previous_task.get("status") in {"completed", "cancelled", "failed", "stopped"}
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
            "partial_thinking": "", "active_operation": None, "tool_batch": None,
            "completed_tool_results": {}, "workflow_outcome": None, "settings": {"model": model, "provider_id": provider.provider_id,
                "context": state["context"], "max_tokens": state["max_tokens"], "reasoning": reasoning,
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
        controller = {"cancel": threading.Event(), "engine": None, "pending": {}, "session": turn.session, "source": source, "working": working,
                     "turn_id": turn_id, "checkpoint_lock": threading.RLock(), "last_checkpoint": time.monotonic(),
                     "last_journal_flush": time.monotonic(), "journal_pending": [], "current_operation_id": None,
                     "stop_after_operation": False}
        with self.active_lock:
            self.active = controller
        saved = self.sessions.save(controller["session"])
        if not (saved["app_saved"] and saved["project_saved"]):
            self.emit({"type": "session_mirror_error", "sessionId": state["session_id"], "appSaved": saved["app_saved"], "projectSaved": saved["project_saved"], "error": saved["error"] or "Session storage is unavailable."})
        self.emit({"type": "run_started", "sessionId": state["session_id"], "turnId": turn_id})
        if new_task:
            self._publish_run_event(controller, turn, {"type": "plan", "items": copy.deepcopy(state["plan"]),
                                                       "acceptanceCriteria": [], "source": "workbench"})
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
                    run_state["safe_messages"] = copy.deepcopy(state.get("messages", []))
                    run_state["partial_content"] = ""
                    run_state["partial_thinking"] = ""
                saved = self.sessions.save(state)
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
                    saved = self.sessions.save(state)
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
                    saved = self.sessions.save(state)
                    if not (saved["app_saved"] and saved["project_saved"]):
                        self.emit({"type": "session_mirror_error", "sessionId": state["session_id"],
                                   "appSaved": saved["app_saved"], "projectSaved": saved["project_saved"],
                                   "error": saved["error"] or "Approval decision could not be mirrored."})
                self.emit({"type": "activity_event", "activity": copy.deepcopy(activity), "sessionId": state["session_id"], "turnId": controller["turn_id"]})
                return bool(result["approved"])

            current_run_state = state.get("run_state")
            run_permission_rules = copy.deepcopy(current_run_state.get("settings", {}).get("permission_rules", [])) if isinstance(current_run_state, dict) else []
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
            )
            chosen_runtime = self.providers.runtime_for(turn.model, engine.runtime, state.get("provider_id"))
            engine.runtime = RequestScopedOllama(chosen_runtime)
            engine.state["reasoning"] = state.get("reasoning")
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
                    {"error": "failed", "cancelled": "cancelled", "stopped_after_operation": "stopped"}.get(str(terminal.get("type")), "failed")
                    if terminal else str(successful_completion.get("workflowOutcome", "discussion")) if successful_completion else "failed"
                )
                run_state["active_operation"] = None
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
            saved = self.sessions.save(state)
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
            finish_task(state.get("task_checkpoint", {}), "failed", blocker=f"{type(exc).__name__}: {exc}")
            state["messages"] = state.get("messages", [])
            update_turn_record("failed")
            if isinstance(state.get("run_state"), dict):
                state["run_state"]["status"] = "failed"
                state["run_state"]["workflow_outcome"] = "failed"
                state["run_state"]["active_operation"] = None
            state["last_error"] = {"message": f"{type(exc).__name__}: {exc}", "occurred_at": time.time()}
            try:
                self.sessions.save(state)
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
            pending = self.active.get("pending", {}).get(action_id) if self.active else None
        if not pending:
            return False
        condition, result = pending
        with condition:
            result.update(done=True, approved=approved)
            condition.notify_all()
        return True

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
        for condition, result in pending:
            with condition:
                result.update(done=True, approved=False)
                condition.notify_all()
        return True


def main() -> None:
    service = AgentService()
    warnings = [service.permission_rules_warning] if service.permission_rules_warning else []
    sys.stdout.write(json.dumps({"type": "ready", "version": "0.1.0", "warnings": warnings}) + "\n")
    sys.stdout.flush()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
            if not isinstance(message, dict):
                raise ValueError("Request must be a JSON object.")
            if service.dispatch(message):
                return
        except Exception as exc:
            service.respond("", False, error=f"{type(exc).__name__}: {exc}")
    service.cancel()
    service.mcp.shutdown()


if __name__ == "__main__":
    try:
        main()
    except BaseException:
        traceback.print_exc(file=sys.stderr)
        raise
