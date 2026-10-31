import threading
import time
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
        "reasoning": {"support": "unknown", "default": None, "values": []},
        "provider": "ollama", "context_limit_known": True,
    }


def test_model_info_exposes_exact_ollama_reasoning_values(service):
    service.runtime.info = {
        "model_info": {"test.context_length": 262144},
        "thinking": {"default": "medium", "values": ["low", "medium", "high", False]},
    }
    result = service.handle("model_info", {"model": "model-a:latest"})
    assert result["reasoning"] == {
        "support": "levels", "default": "medium", "values": ["low", "medium", "high", False],
    }


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


def test_approval_reply_signals_only_matching_pending_action(service):
    condition = threading.Condition()
    result = {"done": False, "approved": False}
    service.active = {"pending": {"action-1": (condition, result)}}
    assert service.approval_reply("missing", True) is False
    assert service.approval_reply("action-1", True) is True
    assert result == {"done": True, "approved": True}
