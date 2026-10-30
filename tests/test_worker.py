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
    return result


def test_dynamic_models_and_full_advertised_context(service):
    assert service.handle("models", {}) == ["model-a:latest", "model-b:latest"]
    info = service.handle("model_info", {"model": "model-a:latest"})
    assert info == {"model": "model-a:latest", "context": 262144, "reasoning": "model-default"}


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


def test_approval_reply_signals_only_matching_pending_action(service):
    condition = threading.Condition()
    result = {"done": False, "approved": False}
    service.active = {"pending": {"action-1": (condition, result)}}
    assert service.approval_reply("missing", True) is False
    assert service.approval_reply("action-1", True) is True
    assert result == {"done": True, "approved": True}
