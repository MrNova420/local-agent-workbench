import io
import json
import threading
import time
from types import SimpleNamespace
from pathlib import Path

import pytest

from sidecar import worker


class FakeRuntime:
    def __init__(self):
        self.cancelled = False
        self.info = {"model_info": {"test.context_length": 262144}}

    def models(self):
        return ["model-a:latest", "model-b:latest"]

    def model_info(self, _model):
        return self.info

    def loaded(self):
        return []

    def preload(self, model, context, keep_alive):
        self.preloaded = (model, context, keep_alive)
        return {"load_duration": 1_500_000_000}


@pytest.fixture
def service(tmp_path, monkeypatch):
    monkeypatch.setattr(worker, "APP_DATA", tmp_path / "appdata")
    result = worker.AgentService()
    result.runtime = FakeRuntime()
    result.providers.by_id("ollama").client = result.runtime
    return result


def test_dynamic_models_and_full_advertised_context(service):
    assert service.handle("models", {}) == ["model-a:latest", "model-b:latest"]
    info = service.handle("model_info", {"model": "model-a:latest"})
    assert info == {
        "model": "model-a:latest", "context": 262144, "max_output_tokens": None,
        "family": None, "parameter_size": None, "quantization": None,
        "capabilities": [], "tool_support": "unknown",
        "reasoning": {"support": "unknown", "default": None, "values": []},
        "provider": "ollama", "context_limit_known": True,
    }


def test_ollama_preload_uses_requested_context_and_keep_alive_without_starting_inference(service):
    events = []
    service.emit = events.append

    result = service.handle("ollama_preload", {
        "model": "model-a:latest", "context": 65536, "keepAlive": "30m",
    })
    thread = service.ollama_preload_thread
    assert result == {"accepted": True, "model": "model-a:latest"}
    thread.join(2)

    assert service.runtime.preloaded == ("model-a:latest", 65536, "30m")
    complete = next(event for event in events if event["type"] == "ollama_preload_complete")
    assert complete["load_duration_seconds"] == 1.5
    assert complete["elapsed_seconds"] >= 0


def test_ollama_preload_does_not_replace_a_different_loaded_model(service):
    class LoadedRuntime(FakeRuntime):
        def __init__(self):
            super().__init__()
            self.preloaded = None

        def loaded(self):
            return [{"name": "model-b:latest", "context_length": 8192}]

    service.runtime = LoadedRuntime()
    events = []
    service.emit = events.append

    result = service.handle("ollama_preload", {
        "model": "model-a:latest", "context": 65536, "keepAlive": "30m",
    })

    assert result["accepted"] is False
    assert "model-b:latest" in result["reason"]
    assert service.runtime.preloaded is None
    assert events[-1]["type"] == "ollama_preload_skipped"


def test_new_task_cannot_start_while_ollama_preload_is_in_flight(service):
    entered = threading.Event()
    release = threading.Event()

    class BlockingRuntime(FakeRuntime):
        def preload(self, _model, _context, _keep_alive):
            entered.set()
            release.wait(2)

    service.runtime = BlockingRuntime()
    service.handle("ollama_preload", {"model": "model-a:latest", "context": 65536, "keepAlive": "30m"})
    assert entered.wait(1)
    with pytest.raises(RuntimeError, match="still preloading"):
        service.handle("run_start", {"options": {"prompt": "hello"}})
    release.set()
    service.ollama_preload_thread.join(2)


def test_ollama_preload_respects_immediate_unload_setting(service):
    events = []
    service.emit = events.append

    result = service.handle("ollama_preload", {
        "model": "model-a:latest", "context": 65536, "keepAlive": "0",
    })

    assert result["accepted"] is False
    assert "unload the model immediately" in result["reason"]
    assert not hasattr(service.runtime, "preloaded")
    assert events[-1]["type"] == "ollama_preload_skipped"


def test_model_info_exposes_exact_ollama_reasoning_values(service):
    service.runtime.info = {
        "model_info": {"test.context_length": 262144, "general.family": "qwen", "general.parameter_size": "9B", "general.quantization_level": "Q4_K_M"},
        "thinking": {"default": "medium", "values": ["low", "medium", "high", False]},
        "capabilities": ["completion", "tools", "thinking"],
    }
    result = service.handle("model_info", {"model": "model-a:latest"})
    assert result["reasoning"] == {
        "support": "levels", "default": "medium", "values": ["low", "medium", "high", False],
    }
    assert (result["family"], result["parameter_size"], result["quantization"]) == ("qwen", "9B", "Q4_K_M")
    assert result["capabilities"] == ["completion", "thinking", "tools"]
    assert result["tool_support"] == "supported"


def test_model_info_reports_known_missing_tool_capability(service):
    service.runtime.info = {"model_info": {}, "capabilities": ["completion"]}
    result = service.handle("model_info", {"model": "model-a:latest"})
    assert result["tool_support"] == "unsupported"


def test_tool_catalog_lists_real_tools_and_unimplemented_integrations(service):
    catalog = service.handle("tool_catalog", {})
    names = {item["name"] for item in catalog["tools"]}
    assert {"list_files", "search_files", "read_file", "write_file", "edit_file", "apply_patch", "run_command"} <= names
    assert all(item["source"] == "built-in" for item in catalog["tools"])
    integrations = {item["name"]: item for item in catalog["integrations"]}
    assert integrations["Local and remote MCP tools"]["status"] == "available"
    assert integrations["Browser automation"]["status"] == "planned"
    assert integrations["LSP diagnostics and navigation"]["status"] == "planned"


def test_gguf_registration_is_stable_and_uses_unknown_training_context(service, tmp_path):
    model = tmp_path / "model.gguf"
    model.write_bytes(b"fixture")
    registered = service.handle("gguf_register", {"path": str(model)})
    again = service.handle("gguf_register", {"path": str(model)})
    assert registered == again
    assert registered["id"].startswith("gguf::")
    assert service.handle("models", {})[-1] == registered["id"]
    info = service.handle("model_info", {"model": registered["id"]})
    assert info["context"] is None
    assert info["context_limit_known"] is False
    assert info["provider"] == "llama.cpp"
    assert info["reasoning"]["values"] == [False, True, "minimal", "low", "medium", "high", "xhigh", "max"]


def test_sessions_are_filtered_by_exact_project_root(service, tmp_path):
    first = tmp_path / "first"
    second = tmp_path / "second"
    first.mkdir(); second.mkdir()
    a = service.handle("session_new", {"workspace": str(first), "model": "model-a:latest", "context": 262144})
    service.handle("session_new", {"workspace": str(second), "model": "model-b:latest", "context": 8192})
    rows = service.handle("sessions_list", {"workspace": str(first)})
    assert [row["session_id"] for row in rows] == [a["session_id"]]
    assert (first / ".agent-workbench" / "sessions" / f"{a['session_id']}.json").is_file()


def test_workspace_history_and_session_conflict_resolution(service, tmp_path):
    project = tmp_path / "project"
    project.mkdir()
    service.handle("workspace_record", {"workspace": str(project)})
    workspaces = service.handle("workspaces_list", {})
    assert workspaces[0]["path"] == str(project.resolve())
    assert workspaces[0]["available"] is True

    session = service.handle("session_new", {"workspace": str(project), "model": "model-a:latest", "context": 8192})
    mirror = project / ".agent-workbench" / "sessions" / f"{session['session_id']}.json"
    import json
    state = json.loads(mirror.read_text(encoding="utf-8"))
    state["messages"].append({"role": "user", "content": "project-only update"})
    state["updated_at"] += 1
    mirror.write_text(json.dumps(state), encoding="utf-8")

    conflict = service.handle("session_resume", {"sessionId": session["session_id"], "workspace": str(project)})
    resolved = service.handle("session_resume", {"sessionId": session["session_id"], "workspace": str(project), "source": "project"})

    assert conflict["conflict"] is True
    assert conflict["recommended_source"] == "project"
    assert resolved["session_id"] == session["session_id"]
    assert resolved["messages"][-1]["content"] == "project-only update"


def test_activity_mode_is_saved_in_both_session_copies_and_restored(service, tmp_path):
    project = tmp_path / "activity-mode-project"
    project.mkdir()
    session = service.handle("session_new", {"workspace": str(project), "model": "model-a:latest",
                                              "context": 262144, "activityMode": "inline"})
    assert session["activity_mode"] == "inline"

    service.handle("session_activity_mode", {"sessionId": session["session_id"], "activityMode": "sidebar"})
    loaded = service.handle("session_resume", {"sessionId": session["session_id"], "workspace": str(project)})
    project_copy = json.loads((project / ".agent-workbench" / "sessions" / f"{session['session_id']}.json").read_text(encoding="utf-8"))

    assert loaded["activity_mode"] == "sidebar"
    assert project_copy["activity_mode"] == "sidebar"


def test_harness_profile_toggle_is_saved_in_both_session_copies(service, tmp_path):
    project = tmp_path / "harness-profile-project"
    project.mkdir()
    session = service.handle("session_new", {"workspace": str(project), "model": "model-a:latest", "context": 262144})

    updated = service.handle("session_harness_profile", {"sessionId": session["session_id"], "harnessProfile": "small-model"})
    loaded = service.handle("session_resume", {"sessionId": session["session_id"], "workspace": str(project)})
    project_copy = json.loads((project / ".agent-workbench" / "sessions" / f"{session['session_id']}.json").read_text(encoding="utf-8"))

    assert updated["harness_profile"] == "small-model"
    assert loaded["harness_profile"] == "small-model"
    assert project_copy["harness_profile"] == "small-model"


def test_interrupted_recovery_retry_warns_and_restore_does_not_run(service, tmp_path):
    project = tmp_path / "recovery-choice-project"
    project.mkdir()
    session = service.sessions.create(str(project), "model-a:latest", 262144)
    session["run_state"] = {"status": "interrupted", "turn_id": "turn-old", "safe_messages": session["messages"],
                            "uncertain_operation": {"name": "write_file", "arguments": {"path": "x.py"}}}
    service.sessions.save(session)

    retry = service.handle("session_recover", {"sessionId": session["session_id"], "action": "retry"})
    assert retry["action"] == "retry"
    assert "may already have partially or fully completed" in retry["prompt"]
    assert "inspect the current workspace" in retry["prompt"]

    session["run_state"]["status"] = "interrupted"
    service.sessions.save(session)
    restored = service.handle("session_recover", {"sessionId": session["session_id"], "action": "restore"})
    assert restored["action"] == "restore"
    assert restored["state"]["run_state"]["status"] == "restored"


def test_stop_after_operation_command_marks_engine(service):
    class Engine:
        requested = False
        def finish_after_operation(self):
            self.requested = True

    engine = Engine()
    service.active = {"engine": engine}
    assert service.handle("run_stop_after_operation", {}) == {"requested": True}
    assert engine.requested is True


def test_activity_events_checkpoint_complete_results_and_unstarted_calls(service, tmp_path, monkeypatch):
    project = tmp_path / "checkpoint-project"
    project.mkdir()
    state = service.sessions.create(str(project), "model-a:latest", 4096)
    state["messages"].append({"role": "user", "content": "do work"})
    state["run_state"] = {"status": "running", "turn_id": "turn-1", "safe_messages": list(state["messages"]),
                          "partial_content": "", "partial_thinking": "", "active_operation": None,
                          "tool_batch": None, "completed_tool_results": {}}
    service.sessions.save(state)
    controller = {"session": state, "turn_id": "turn-1", "checkpoint_lock": threading.RLock(),
                  "last_checkpoint": time.monotonic() - 3}
    emitted = []
    monkeypatch.setattr(service, "emit", emitted.append)
    turn = SimpleNamespace(workspace=project)
    batch_message = {"role": "assistant", "content": "", "tool_calls": [
        {"id": "call-a", "function": {"name": "run_command", "arguments": {}}},
        {"id": "call-b", "function": {"name": "write_file", "arguments": {}}},
    ]}

    service._publish_run_event(controller, turn, {"type": "tool_batch", "assistantMessage": batch_message,
                                 "calls": [{"id": "call-a", "name": "run_command"}, {"id": "call-b", "name": "write_file"}]})
    service._publish_run_event(controller, turn, {"type": "tool_start", "operationId": "op-a", "toolCallId": "call-a",
                                 "name": "run_command", "arguments": {"argv": ["python"]}, "startedAt": 1})
    service._publish_run_event(controller, turn, {"type": "operation_output", "operationId": "op-a", "stream": "stdout", "text": "full log " * 3000})
    service._publish_run_event(controller, turn, {"type": "tool_done", "operationId": "op-a", "toolCallId": "call-a",
                                 "name": "run_command", "result": "complete result " * 2000, "affectedFiles": [], "completedAt": 2})
    service._publish_run_event(controller, turn, {"type": "tool_done", "operationId": "op-b", "toolCallId": "call-b",
                                 "name": "write_file", "result": "second result", "affectedFiles": ["src/a.py"], "completedAt": 3})

    saved = service.sessions.load(state["session_id"])
    activity = next(item for item in saved["activity_events"] if item["operationId"] == "op-a")
    checkpoint_tools = [message for message in saved["run_state"]["safe_messages"] if message.get("role") == "tool"]
    assert len(activity["output"]["stdout"]) > 12000
    assert len(activity["result"]) > 12000
    assert checkpoint_tools[0]["content"] == "complete result " * 2000
    assert checkpoint_tools[1]["content"] == "second result"
    assert sum(message.get("role") == "assistant" and bool(message.get("tool_calls")) for message in saved["run_state"]["safe_messages"]) == 1
    assert any(event["type"] == "activity_event" for event in emitted)


def test_run_errors_are_persisted_as_rehydratable_activity(service, tmp_path, monkeypatch):
    project = tmp_path / "error-activity-project"
    project.mkdir()
    state = service.sessions.create(str(project), "model-a:latest", 4096)
    controller = {"session": state, "turn_id": "turn-error", "checkpoint_lock": threading.RLock(),
                  "last_checkpoint": time.monotonic() - 3}
    emitted = []
    monkeypatch.setattr(service, "emit", emitted.append)

    service._publish_run_event(controller, SimpleNamespace(workspace=project),
                               {"type": "error", "error": "Provider headers timed out"})

    saved = service.sessions.load(state["session_id"])
    error = next(item for item in saved["activity_events"] if item["kind"] == "error")
    envelope = next(event for event in emitted if event["type"] == "activity_event")
    assert error["status"] == "failed"
    assert error["result"] == "Provider headers timed out"
    assert error["turnId"] == "turn-error"
    assert envelope["activity"] == error


def test_crash_recovery_marks_inflight_write_uncertain_and_never_replays_it(service, tmp_path):
    project = tmp_path / "interrupted-project"
    project.mkdir()
    state = service.sessions.create(str(project), "model-a:latest", 4096)
    state["messages"].append({"role": "user", "content": "update config"})
    state["activity_events"] = [{"id": "op-1", "operationId": "op-1", "kind": "operation", "name": "write_file", "status": "running", "arguments": {"path": "config.json"}}]
    state["run_state"] = {"status": "running", "turn_id": "turn-1", "prompt": "update config",
                          "safe_messages": list(state["messages"]), "partial_content": "partial reply",
                          "partial_thinking": "", "active_operation": {"operationId": "op-1", "toolCallId": "call-1", "name": "write_file", "arguments": {"path": "config.json"}},
                          "tool_batch": {"assistant_message": {"role": "assistant", "tool_calls": [{"id": "call-0"}, {"id": "call-1"}, {"id": "call-2"}]},
                                         "calls": [{"id": "call-0"}, {"id": "call-1"}, {"id": "call-2"}],
                                         "base_messages": list(state["messages"])},
                          "completed_tool_results": {"call-0": "finished"}}
    service.sessions.save(state)

    loaded = service.handle("session_resume", {"sessionId": state["session_id"], "workspace": str(project)})
    recovered = service.handle("session_recover", {"sessionId": state["session_id"], "action": "resume"})

    assert loaded["run_state"]["status"] == "interrupted"
    assert loaded["run_state"]["uncertain_operation"]["name"] == "write_file"
    assert loaded["activity_events"][0]["status"] == "uncertain"
    assert recovered["action"] == "resume"
    assert "inspect its current effect" in recovered["prompt"]
    assert any(message.get("role") == "user" and message.get("content") == "update config" for message in recovered["state"]["messages"])
    assert recovered["state"]["last_recovery"]["action"] == "resume"
    tools = [message for message in loaded["run_state"]["safe_messages"] if message.get("role") == "tool"]
    assert [message["content"] for message in tools] == [
        "finished",
        "Uncertain: this operation was interrupted and may have partially or fully completed. Inspect the workspace before retrying.",
        "Not executed: the process was interrupted before this operation started.",
    ]


def test_resume_does_not_rebind_a_session_to_another_project(service, tmp_path, monkeypatch):
    first = tmp_path / "source"; second = tmp_path / "other"
    first.mkdir(); second.mkdir()
    saved = service.handle("session_new", {"workspace": str(first), "model": "model-a:latest", "context": 4096})
    options = {
        "workspace": str(second), "sessionId": saved["session_id"], "prompt": "inspect",
        "model": "model-a:latest", "context": 4096, "maxTokens": 128,
        "temperature": 0.2, "access": "ask", "approvalMode": "per-action",
    }
    with pytest.raises(ValueError, match="different project"):
        service._start_run(options)


def test_one_frozen_workspace_per_run_and_no_second_run(service, tmp_path, monkeypatch):
    first = tmp_path / "first"; second = tmp_path / "second"
    first.mkdir(); second.mkdir()
    started = threading.Event(); release = threading.Event(); captured = []

    class BlockingEngine:
        def __init__(self, root, model, context, access, approval, event, approve, **kwargs):
            self.root = Path(root).resolve(); self.event = event; captured.append(self.root)
            self.state = {}; self.runtime = object()

        def run(self, prompt, messages):
            started.set()
            release.wait(3)
            messages.append({"role": "user", "content": prompt})
            self.event({"type": "complete", "elapsed": 0.1})
            return messages

        def cancel(self):
            release.set()

    monkeypatch.setattr(worker, "AgentEngine", BlockingEngine)
    options = {"workspace": str(first), "prompt": "hello", "model": "model-a:latest", "context": 4096,
               "maxTokens": 128, "temperature": 0.2, "access": "ask", "approvalMode": "per-action"}
    service.handle("run_start", {"options": options})
    controller = service.active
    assert controller is not None
    assert started.wait(2)
    other = {**options, "workspace": str(second)}
    with pytest.raises(RuntimeError, match="already running"):
        service.handle("run_start", {"options": other})
    assert captured == [first.resolve()]
    release.set()
    controller["thread"].join(3)
    assert service.active is None
    assert service.sessions.list()[0]["workspace"] == str(first.resolve())


def test_cancel_interrupts_current_engine_without_unloading_ollama(service):
    class CurrentEngine:
        cancelled = False
        def cancel(self): self.cancelled = True

    engine = CurrentEngine()
    service.active = {"cancel": threading.Event(), "engine": engine, "pending": {}}
    service.cancel()
    assert engine.cancelled is True
    assert service.active["cancel"].is_set()
    assert service.runtime.cancelled is False


def test_keep_alive_is_not_passed_as_an_ollama_generation_option(service, tmp_path, monkeypatch):
    captured = {}
    engines = []

    class CapturingEngine:
        def __init__(self, root, model, context, access, approval, event, approve, **kwargs):
            captured.update(kwargs)
            self.state = {}
            self.runtime = object()
            engines.append(self)

        def run(self, prompt, messages):
            messages.append({"role": "user", "content": prompt})
            return messages

        def cancel(self):
            pass

    monkeypatch.setattr(worker, "AgentEngine", CapturingEngine)
    project = tmp_path / "project"
    project.mkdir()
    options = {
        "workspace": str(project), "prompt": "hello", "model": "model-a:latest",
        "context": 4096, "maxTokens": 128, "temperature": 0.2,
        "access": "ask", "approvalMode": "per-action", "keepAlive": "3h",
    }
    service.handle("run_start", {"options": options})
    controller = service.active
    assert controller is not None
    controller["thread"].join(3)

    assert "keep_alive" not in captured["runtime_options"]
    assert captured["runtime_options"] == {}
    assert engines[0].state["keep_alive"] == "3h"


def test_engine_failure_is_saved_with_the_session(service, tmp_path, monkeypatch):
    class FailingEngine:
        def __init__(self, root, model, context, access, approval, event, approve, **kwargs):
            self.state = {}
            self.runtime = object()
            self.event = event

        def run(self, prompt, messages):
            messages.append({"role": "user", "content": prompt})
            self.event({"type": "error", "error": "Synthetic provider stream failure"})
            return messages

        def cancel(self):
            pass

    monkeypatch.setattr(worker, "AgentEngine", FailingEngine)
    project = tmp_path / "project"
    project.mkdir()
    options = {
        "workspace": str(project), "prompt": "hello", "model": "model-a:latest",
        "context": 4096, "maxTokens": 128, "temperature": 0.2,
        "access": "ask", "approvalMode": "per-action",
    }
    service.handle("run_start", {"options": options})
    controller = service.active
    assert controller is not None
    session_id = controller["session"]["session_id"]
    controller["thread"].join(3)

    saved = service.sessions.load(session_id)
    assert saved["last_error"]["message"] == "Synthetic provider stream failure"
    assert saved["run_state"]["status"] == "failed"


def test_worker_exception_is_added_to_persisted_activity(service, tmp_path, monkeypatch):
    class RaisingEngine:
        def __init__(self, root, model, context, access, approval, event, approve, **kwargs):
            self.state = {}
            self.runtime = object()

        def run(self, prompt, messages):
            raise RuntimeError("Synthetic worker exception")

        def cancel(self):
            pass

    monkeypatch.setattr(worker, "AgentEngine", RaisingEngine)
    project = tmp_path / "raising-project"
    project.mkdir()
    options = {"workspace": str(project), "prompt": "hello", "model": "model-a:latest",
               "context": 4096, "maxTokens": 128, "temperature": 0.2,
               "access": "ask", "approvalMode": "per-action"}
    service.handle("run_start", {"options": options})
    controller = service.active
    assert controller is not None
    session_id = controller["session"]["session_id"]
    controller["thread"].join(3)

    saved = service.sessions.load(session_id)
    errors = [item for item in saved["activity_events"] if item["kind"] == "error"]
    assert len(errors) == 1
    assert errors[0]["status"] == "failed"
    assert errors[0]["result"] == "RuntimeError: Synthetic worker exception"


def test_protocol_escapes_unicode_for_legacy_windows_stdout(service, monkeypatch):
    buffer = io.BytesIO()
    stdout = io.TextIOWrapper(buffer, encoding="cp1252", write_through=True)
    monkeypatch.setattr(worker.sys, "stdout", stdout)

    service.emit({"type": "text", "text": "Hello 👋"})
    service.respond("unicode-response", True, {"text": "Hello 👋"})

    rows = [json.loads(line) for line in buffer.getvalue().decode("cp1252").splitlines()]
    assert rows[0]["event"]["text"] == "Hello 👋"
    assert rows[1]["data"]["text"] == "Hello 👋"


def test_approval_reply_signals_only_matching_pending_action(service):
    condition = threading.Condition()
    result = {"done": False, "approved": False}
    service.active = {"pending": {"action-1": (condition, result)}}
    assert service.approval_reply("missing", True) is False
    assert service.approval_reply("action-1", True) is True
    assert result == {"done": True, "approved": True}


def test_approval_state_is_recorded_on_the_operation_without_a_duplicate_trace_row(service, tmp_path, monkeypatch):
    events = []
    service.emit = events.append

    class ApprovalEngine:
        def __init__(self, root, model, context, access, approval, event, approve, **kwargs):
            self.event = event
            self.approve = approve
            self.state = {}
            self.runtime = object()

        def run(self, prompt, messages):
            self.event({"type": "tool_start", "operationId": "op-1", "toolCallId": "call-1", "name": "write_file",
                        "arguments": {"path": "index.html"}, "startedAt": 1})
            assert self.approve("write_file", {"path": "index.html"}) is True
            self.event({"type": "tool_done", "operationId": "op-1", "toolCallId": "call-1", "status": "completed",
                        "result": "wrote index.html", "affectedFiles": ["index.html"], "completedAt": 2})
            return messages

        def cancel(self):
            pass

    monkeypatch.setattr(worker, "AgentEngine", ApprovalEngine)
    project = tmp_path / "approval-project"
    project.mkdir()
    service.handle("run_start", {"options": {
        "workspace": str(project), "prompt": "create a page", "model": "model-a:latest",
        "context": 4096, "maxTokens": 128, "temperature": 0.2,
        "access": "ask", "approvalMode": "per-action",
    }})
    controller = service.active
    assert controller is not None

    deadline = time.monotonic() + 2
    request = None
    while time.monotonic() < deadline:
        request = next((item for item in events if item.get("type") == "approval_request"), None)
        if request:
            break
        time.sleep(0.01)
    assert request is not None
    assert service.approval_reply(request["actionId"], True) is True
    controller["thread"].join(3)

    saved = service.sessions.load(controller["session"]["session_id"])
    operations = [item for item in saved["activity_events"] if item.get("operationId") == "op-1"]
    assert len(operations) == 1
    assert operations[0]["kind"] == "operation"
    assert operations[0]["approvalStatus"] == "approved"
    assert operations[0]["status"] == "completed"
