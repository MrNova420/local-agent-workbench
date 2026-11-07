import asyncio
import copy
import io
import json
import threading
import time
from types import SimpleNamespace
from pathlib import Path
from unittest.mock import patch

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


def test_provider_prompt_calibration_is_app_wide_and_does_not_overwrite_better_session_observation(service, tmp_path):
    service.token_calibrations.observe("ollama", "flint:latest", 1000, 400)
    checkpoint = {"provider_token_calibrations": {
        "ollama|flint:latest": {"max_observed_ratio": 0.45, "observation_count": 3},
    }}

    service._seed_provider_token_calibration(checkpoint)

    calibration = checkpoint["provider_token_calibrations"]["ollama|flint:latest"]
    assert calibration["max_observed_ratio"] == 0.45
    assert calibration["observation_count"] >= 3
    engine = worker.AgentEngine(tmp_path, model="flint:latest", context=65_536,
                                task_checkpoint=checkpoint, provider_id="ollama")
    assert engine.context.request_estimate_method.startswith("model-calibrated")
    assert engine.state["context"] == 65_536
    assert service._record_provider_prompt_calibration(
        {"provider_id": "llama.cpp", "model": "flint:latest"},
        {"estimated_input_tokens": 100}, {"prompt_eval_count": 80},
    )["observation_count"] == 1
    saved = service.token_calibrations.load()
    assert saved["llama.cpp|flint:latest"]["last_provider_tokens"] == 80


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


def test_hugging_face_download_accepts_user_selected_batches_over_500(service, tmp_path):
    downloaded = []
    events = []

    def download(_repo, _revision, filename, _cancel, _emit):
        downloaded.append(filename)
        return tmp_path / filename

    service.hf = SimpleNamespace(download=download)
    service.emit = events.append
    files = [f"part-{index}.bin" for index in range(501)]

    result = service._start_hf_download({"repo": "owner/model", "revision": "main", "files": files})
    service.hf_download_thread.join(timeout=5)

    assert result == {"started": True, "repo": "owner/model", "revision": "main", "files": 501}
    assert downloaded == files
    assert events[-1]["type"] == "hf_download_job_complete"


def test_hugging_face_search_forwards_opaque_page_cursor(service):
    captured = []
    service.hf = SimpleNamespace(search_page=lambda query, cursor=None: captured.append((query, cursor)) or {
        "models": [{"repo": "owner/model", "revision": "rev", "downloads": 1, "likes": 0, "gated": False}],
        "next_cursor": "https://huggingface.co/api/models?cursor=opaque",
    })

    result = service.handle("hf_search", {"query": "coder", "cursor": "https://huggingface.co/api/models?cursor=opaque"})

    assert captured == [("coder", "https://huggingface.co/api/models?cursor=opaque")]
    assert result["next_cursor"].endswith("cursor=opaque")


def test_hugging_face_repo_file_request_forwards_opaque_page_cursor(service):
    captured = []
    service.hf = SimpleNamespace(repo_files_page=lambda repo, revision, cursor=None: captured.append((repo, revision, cursor)) or {
        "files": [{"path": "shard-2.gguf", "format": "gguf", "size": 1, "is_lfs": True, "revision": revision}],
        "next_cursor": None,
    })

    result = service.handle("hf_repo_files", {
        "repo": "owner/model", "revision": "pinned-revision",
        "cursor": "https://huggingface.co/api/models/owner/model/tree/pinned-revision?cursor=opaque",
    })

    assert captured == [("owner/model", "pinned-revision", "https://huggingface.co/api/models/owner/model/tree/pinned-revision?cursor=opaque")]
    assert result["files"][0]["path"] == "shard-2.gguf"


def test_workspace_file_pages_return_every_project_file_without_a_hidden_cap(service, tmp_path):
    project = tmp_path / "large-project"
    project.mkdir()
    for index in range(2005):
        (project / f"{index:04}.txt").write_text(str(index), encoding="utf-8")

    first = service.handle("workspace_files", {"workspace": str(project), "offset": 0, "limit": 500})
    later = service.handle("workspace_files", {"workspace": str(project), "offset": 2000, "limit": 500})

    assert first["files"][0]["path"] == "0000.txt"
    assert first["next_offset"] == 500
    assert later["files"][-1]["path"] == "2004.txt"
    assert later["next_offset"] is None


def test_workspace_file_pages_reuse_the_live_walk_across_sidecar_requests(service, tmp_path):
    import project_view

    project = tmp_path / "paged-project"
    project.mkdir()
    for name in ("a.txt", "b.txt", "c.txt", "d.txt", "e.txt", "f.txt"):
        (project / name).write_text(name, encoding="utf-8")

    traversed = []
    real_walk = project_view.iter_project_files

    def recording_walk(*args, **kwargs):
        for path in real_walk(*args, **kwargs):
            traversed.append(path.name)
            yield path

    with patch("project_view.iter_project_files", side_effect=recording_walk):
        first = service.handle("workspace_files", {"workspace": str(project), "offset": 0, "limit": 2})
        service.handle("models", {})
        second = service.handle("workspace_files", {"workspace": str(project), "offset": 2, "limit": 2})

    assert [row["path"] for row in first["files"]] == ["a.txt", "b.txt"]
    assert [row["path"] for row in second["files"]] == ["c.txt", "d.txt"]
    assert len(traversed) == 5
    assert len(set(traversed)) == 5


def test_workspace_file_page_cursor_is_replaced_when_the_selected_project_changes(service, tmp_path):
    first_project = tmp_path / "first-project"
    second_project = tmp_path / "second-project"
    first_project.mkdir()
    second_project.mkdir()
    for name in ("a.txt", "b.txt", "c.txt", "d.txt"):
        (first_project / name).write_text(name, encoding="utf-8")
    for name in ("x.txt", "y.txt"):
        (second_project / name).write_text(name, encoding="utf-8")

    first_page = service.handle("workspace_files", {"workspace": str(first_project), "offset": 0, "limit": 2})
    other_project_page = service.handle("workspace_files", {"workspace": str(second_project), "offset": 0, "limit": 1})
    resumed_project_page = service.handle("workspace_files", {"workspace": str(first_project), "offset": 2, "limit": 2})

    assert [row["path"] for row in first_page["files"]] == ["a.txt", "b.txt"]
    assert [row["path"] for row in other_project_page["files"]] == ["x.txt"]
    assert [row["path"] for row in resumed_project_page["files"]] == ["c.txt", "d.txt"]


def test_global_session_library_finds_project_only_sessions_from_workspace_history(service, tmp_path):
    project = tmp_path / "project-only-session"
    project.mkdir()
    state = service.sessions.create(str(project), "model-a:latest", 4096)
    service.workspaces.record(str(project))
    (service.sessions.app.root / f"{state['session_id']}.json").unlink()

    rows = service.handle("sessions_list", {})

    assert [row["session_id"] for row in rows] == [state["session_id"]]
    assert rows[0]["workspace"] == str(project)
    assert rows[0]["sources"] == ["project"]


def test_session_followup_prompt_queue_is_persisted_and_project_bound(service, tmp_path, monkeypatch):
    project = tmp_path / "queued-prompt-project"
    project.mkdir()
    state = service.sessions.create(str(project), "model-a:latest", 4096)
    events = []
    monkeypatch.setattr(service, "emit", events.append)

    queued = service.handle("session_queue_prompt", {
        "sessionId": state["session_id"], "workspace": str(project), "prompt": "Add a settings page",
    })

    assert len(queued["queuedPrompts"]) == 1
    queued_item = queued["queuedPrompts"][0]
    assert queued_item["prompt"] == "Add a settings page"
    assert service.sessions.load(state["session_id"])["queued_prompts"] == [queued_item]
    assert events[-1]["type"] == "session_queue_update"
    with pytest.raises(ValueError, match="different project"):
        service.handle("session_queue_prompt", {
            "sessionId": state["session_id"], "workspace": str(tmp_path), "prompt": "Wrong project",
        })

    removed = service.handle("session_queue_remove", {
        "sessionId": state["session_id"], "workspace": str(project), "queuedPromptId": queued_item["id"],
    })
    assert removed["queuedPrompts"] == []
    assert service.sessions.load(state["session_id"])["queued_prompts"] == []


def test_followup_queue_request_is_idempotent_for_replayed_ipc(service, tmp_path):
    project = tmp_path / "idempotent-queue-project"
    project.mkdir()
    state = service.sessions.create(str(project), "model-a:latest", 4096)
    request = {"sessionId": state["session_id"], "workspace": str(project),
               "prompt": "Implement the saved follow-up", "clientRequestId": "queue-request-1"}

    first = service.handle("session_queue_prompt", request)
    replay = service.handle("session_queue_prompt", request)

    assert len(first["queuedPrompts"]) == 1
    assert len(replay["queuedPrompts"]) == 1
    assert first["queued"]["id"] == replay["queued"]["id"]
    assert replay["deduplicated"] is True
    assert service.sessions.load(state["session_id"])["queued_prompts"][0]["request_id"] == "queue-request-1"


def test_followup_queue_request_id_cannot_be_reused_for_different_text(service, tmp_path):
    project = tmp_path / "queue-request-id-conflict"
    project.mkdir()
    state = service.sessions.create(str(project), "model-a:latest", 4096)
    base = {"sessionId": state["session_id"], "workspace": str(project), "clientRequestId": "queue-request-2"}
    service.handle("session_queue_prompt", {**base, "prompt": "First task"})

    with pytest.raises(ValueError, match="already used for a different prompt"):
        service.handle("session_queue_prompt", {**base, "prompt": "Different task"})


def test_followup_queue_replay_after_consumption_reports_the_existing_turn(service, tmp_path):
    project = tmp_path / "queue-replay-after-consumption"
    project.mkdir()
    state = service.sessions.create(str(project), "model-a:latest", 4096)
    state["queued_prompts"] = []
    state["turns"] = [{"turn_id": "turn-started", "queue_request_id": "queue-request-3",
                       "prompt": "Run this once", "status": "running"}]
    service.sessions.save(state)

    replay = service.handle("session_queue_prompt", {
        "sessionId": state["session_id"], "workspace": str(project),
        "prompt": "Run this once", "clientRequestId": "queue-request-3",
    })

    assert replay["deduplicated"] is True
    assert replay["alreadyStarted"] is True
    assert replay["turnId"] == "turn-started"
    assert replay["queuedPrompts"] == []
    assert service.sessions.load(state["session_id"])["turns"] == state["turns"]


def test_consume_queued_prompt_requires_exact_id_and_text_and_removes_once():
    item = {"id": "queue-1", "prompt": "Run the saved follow-up", "queued_at": 1.0}
    state = {"queued_prompts": [item]}

    with pytest.raises(ValueError, match="does not match"):
        worker.consume_queued_prompt(state, "queue-1", "Different prompt")
    assert state["queued_prompts"] == [item]

    assert worker.consume_queued_prompt(state, "queue-1", item["prompt"]) == item
    assert state["queued_prompts"] == []
    with pytest.raises(ValueError, match="no longer exists"):
        worker.consume_queued_prompt(state, "queue-1", item["prompt"])


def test_run_start_recognizes_a_queued_prompt_already_recorded_as_a_turn(service, tmp_path, monkeypatch):
    project = tmp_path / "already-started-queue"
    project.mkdir()
    state = service.sessions.create(str(project), "model-a:latest", 4096)
    state["queued_prompts"] = []
    state["turns"] = [{"turn_id": "turn-already-started", "queued_prompt_id": "queue-1",
                       "prompt": "Run the saved follow-up", "status": "completed"}]
    service.sessions.save(state)
    events = []
    monkeypatch.setattr(service, "emit", events.append)

    result = service.handle("run_start", {"options": {
        "workspace": str(project), "sessionId": state["session_id"],
        "queuedPromptId": "queue-1", "prompt": "Run the saved follow-up",
        "model": "model-a:latest", "context": 4096, "maxTokens": 128,
        "temperature": 0.2, "access": "ask", "approvalMode": "per-action",
    }})

    assert result == {"started": False, "queuedPromptAlreadyStarted": True,
                      "turnId": "turn-already-started", "queuedPrompts": []}
    assert service.active is None
    assert not service.run_lock.locked()
    assert any(event.get("type") == "session_queue_update" for event in events)


def test_run_start_request_replay_attaches_to_the_existing_turn_without_restarting(service, tmp_path):
    project = tmp_path / "run-request-replay"
    project.mkdir()
    state = service.sessions.create(str(project), "model-a:latest", 4096)
    options = {"workspace": str(project), "sessionId": state["session_id"],
               "prompt": "Implement this once", "model": "model-a:latest", "context": 4096,
               "maxTokens": 512, "temperature": 0.2, "access": "ask", "approvalMode": "per-action",
               "clientRequestId": "run-request-1"}
    request_id, fingerprint = worker._run_request_identity(options, project.resolve())
    turn = {"turn_id": "turn-run-request", "client_request_id": request_id,
            "request_fingerprint": fingerprint, "prompt": options["prompt"], "status": "running"}
    state["turns"] = [turn]
    service.sessions.save(state)
    service.active = {"session": state, "turn_id": turn["turn_id"]}
    service.run_lock.acquire()
    try:
        replay = service.handle("run_start", {"options": options})
    finally:
        service.run_lock.release()

    assert replay == {"started": False, "runAlreadyStarted": True, "runActive": True,
                     "turnId": "turn-run-request", "turnStatus": "running"}


def test_run_start_request_id_rejects_reuse_with_changed_settings(service, tmp_path):
    project = tmp_path / "run-request-conflict"
    project.mkdir()
    state = service.sessions.create(str(project), "model-a:latest", 4096)
    original = {"workspace": str(project), "sessionId": state["session_id"],
                "prompt": "Implement this once", "model": "model-a:latest", "context": 4096,
                "maxTokens": 512, "temperature": 0.2, "access": "ask", "approvalMode": "per-action",
                "clientRequestId": "run-request-2"}
    request_id, fingerprint = worker._run_request_identity(original, project.resolve())
    state["turns"] = [{"turn_id": "turn-run-request", "client_request_id": request_id,
                       "request_fingerprint": fingerprint, "prompt": original["prompt"], "status": "completed"}]
    service.sessions.save(state)
    changed = {**original, "maxTokens": 2048}

    with pytest.raises(ValueError, match="already used for different task settings"):
        service.handle("run_start", {"options": changed})
    assert service.active is None
    assert not service.run_lock.locked()


def test_run_start_reconciles_a_queued_prompt_removed_from_another_window(service, tmp_path, monkeypatch):
    project = tmp_path / "removed-queue-item"
    project.mkdir()
    state = service.sessions.create(str(project), "model-a:latest", 4096)
    state["queued_prompts"] = []
    state["turns"] = []
    service.sessions.save(state)
    events = []
    monkeypatch.setattr(service, "emit", events.append)

    result = service.handle("run_start", {"options": {
        "workspace": str(project), "sessionId": state["session_id"],
        "queuedPromptId": "queue-removed", "prompt": "Run the removed follow-up",
        "model": "model-a:latest", "context": 4096, "maxTokens": 128,
        "temperature": 0.2, "access": "ask", "approvalMode": "per-action",
    }})

    assert result == {"started": False, "queuedPromptUnavailable": True, "queuedPrompts": []}
    assert service.active is None
    assert not service.run_lock.locked()
    assert any(event.get("type") == "session_queue_update" for event in events)


def test_run_start_returns_queue_reconciliation_if_item_disappears_after_preflight(service, tmp_path, monkeypatch):
    project = tmp_path / "queue-disappears-during-start"
    project.mkdir()
    state = service.sessions.create(str(project), "model-a:latest", 4096)
    state["queued_prompts"] = [{"id": "queue-race", "prompt": "Keep this follow-up", "queued_at": 1.0}]
    service.sessions.save(state)
    events = []
    monkeypatch.setattr(service, "emit", events.append)

    def disappeared(_state, _prompt_id, _prompt):
        raise worker.QueuedPromptUnavailable("That queued prompt no longer exists.")

    monkeypatch.setattr(worker, "consume_queued_prompt", disappeared)
    result = service.handle("run_start", {"options": {
        "workspace": str(project), "sessionId": state["session_id"],
        "queuedPromptId": "queue-race", "prompt": "Keep this follow-up",
        "model": "model-a:latest", "context": 4096, "maxTokens": 128,
        "temperature": 0.2, "access": "ask", "approvalMode": "per-action",
    }})

    assert result["started"] is False
    assert result["queuedPromptUnavailable"] is True
    assert result["queuedPrompts"] == state["queued_prompts"]
    assert service.active is None
    assert not service.run_lock.locked()
    assert any(event.get("type") == "session_queue_update" for event in events)


def test_run_start_fails_closed_when_neither_session_mirror_can_save(service, tmp_path, monkeypatch):
    project = tmp_path / "unsaved-run-project"
    project.mkdir()
    state = service.sessions.create(str(project), "model-a:latest", 4096)
    events = []
    monkeypatch.setattr(service, "emit", events.append)
    monkeypatch.setattr(service.sessions, "save", lambda _state: {
        "app_saved": False, "project_saved": False, "error": "simulated UnicodeEncodeError",
    })

    with pytest.raises(RuntimeError, match="session checkpoint could not be saved.*UnicodeEncodeError"):
        service.handle("run_start", {"options": {
            "workspace": str(project), "sessionId": state["session_id"], "prompt": "Keep this prompt",
            "model": "model-a:latest", "context": 4096, "maxTokens": 128,
            "temperature": 0.2, "access": "ask", "approvalMode": "per-action",
        }})

    assert service.active is None
    assert not service.run_lock.locked()
    assert not any(event.get("type") == "run_started" for event in events)


def test_followup_prompt_queue_updates_only_its_active_session(service, tmp_path, monkeypatch):
    project = tmp_path / "active-queue-project"
    project.mkdir()
    state = service.sessions.create(str(project), "model-a:latest", 4096)
    controller = {"session": state, "checkpoint_lock": threading.RLock(), "accepting_queue": True,
                  "cancel": threading.Event()}
    service.active = controller
    emitted = []
    monkeypatch.setattr(service, "emit", emitted.append)
    journal_rows = []
    append_events = service.sessions.append_events
    def capture_events(session_id, workspace, events):
        journal_rows.extend(dict(row) for row in events)
        return append_events(session_id, workspace, events)
    monkeypatch.setattr(service.sessions, "append_events", capture_events)

    result = service.handle("session_queue_prompt", {
        "sessionId": state["session_id"], "workspace": str(project), "prompt": "Continue with tests",
    })

    assert result["queuedPrompts"] == controller["session"]["queued_prompts"]
    assert not controller["cancel"].is_set()
    assert emitted[-1]["sessionId"] == state["session_id"]
    controller["accepting_queue"] = False
    with pytest.raises(RuntimeError, match="finishing"):
        service.handle("session_queue_prompt", {
            "sessionId": state["session_id"], "workspace": str(project), "prompt": "Must be retried",
        })


def test_active_followup_queue_is_not_acknowledged_if_both_mirrors_fail(service, tmp_path, monkeypatch):
    project = tmp_path / "active-queue-save-failure"
    project.mkdir()
    state = service.sessions.create(str(project), "model-a:latest", 4096)
    initial = list(state.get("queued_prompts", []))
    controller = {"session": state, "checkpoint_lock": threading.RLock(), "accepting_queue": True,
                  "cancel": threading.Event(), "turn_id": "turn-1"}
    service.active = controller
    events = []
    monkeypatch.setattr(service, "emit", events.append)
    monkeypatch.setattr(service.sessions, "save", lambda _state: {
        "app_saved": False, "project_saved": False, "error": "simulated lock",
    })

    with pytest.raises(RuntimeError, match="neither session mirror saved.*simulated lock"):
        service.handle("session_queue_prompt", {
            "sessionId": state["session_id"], "workspace": str(project), "prompt": "Do not lose this follow-up",
        })

    assert controller["session"]["queued_prompts"] == initial
    assert not any(event.get("type") == "session_queue_update" for event in events)
    assert events[-1]["type"] == "session_mirror_error"


def test_active_task_steering_is_saved_to_the_captured_session_and_waits_for_boundary(service, tmp_path, monkeypatch):
    project = tmp_path / "active-steering-project"
    project.mkdir()
    state = service.sessions.create(str(project), "model-a:latest", 4096)
    state["task_checkpoint"] = worker.begin_task(None, prompt="Build the feature", turn_id="turn-1",
                                                workspace=str(project), settings={})
    state["run_state"] = {"status": "running", "turn_id": "turn-1", "safe_messages": []}
    controller = {"session": state, "checkpoint_lock": threading.RLock(), "accepting_steering": True,
                  "pending_steers": [], "turn_id": "turn-1"}
    service.active = controller
    emitted = []
    monkeypatch.setattr(service, "emit", emitted.append)

    result = service.handle("session_steer", {
        "sessionId": state["session_id"], "workspace": str(project), "prompt": "Preserve the current layout",
    })

    assert result["accepted"] is True
    assert result["status"] == "pending"
    assert len(controller["pending_steers"]) == 1
    update = controller["pending_steers"][0]
    saved = service.sessions.load(state["session_id"])
    assert saved["task_checkpoint"]["current"]["user_updates"][-1]["id"] == update["id"]
    assert saved["task_checkpoint"]["current"]["user_updates"][-1]["status"] == "pending"
    assert saved["task_checkpoint"]["current"]["task_id"] == "turn-1"
    assert emitted[-1]["type"] == "steering_update"
    assert emitted[-1]["status"] == "accepted"
    assert not state["run_state"]["safe_messages"]

    with pytest.raises(ValueError, match="different project"):
        service.handle("session_steer", {
            "sessionId": state["session_id"], "workspace": str(tmp_path), "prompt": "Wrong project",
        })


def test_active_inference_steering_is_persisted_before_request_interrupt(service, tmp_path, monkeypatch):
    project = tmp_path / "active-inference-steering-project"
    project.mkdir()
    state = service.sessions.create(str(project), "model-a:latest", 4096)
    state["task_checkpoint"] = worker.begin_task(None, prompt="Build the feature", turn_id="turn-live",
                                                workspace=str(project), settings={})
    state["run_state"] = {"status": "running", "turn_id": "turn-live", "safe_messages": []}
    interrupt = threading.Event()
    controller = {"session": state, "checkpoint_lock": threading.RLock(), "accepting_steering": True,
                  "pending_steers": [], "turn_id": "turn-live", "inference_active": True,
                  "steering_interrupt": interrupt}
    service.active = controller
    emitted = []
    monkeypatch.setattr(service, "emit", emitted.append)

    result = service.handle("session_steer", {
        "sessionId": state["session_id"], "workspace": str(project), "prompt": "Start implementing now",
    })

    assert result["status"] == "interrupting"
    assert interrupt.is_set()
    saved = service.sessions.load(state["session_id"])
    assert saved["task_checkpoint"]["current"]["user_updates"][-1]["instruction"] == "Start implementing now"
    assert emitted[-1]["type"] == "steering_update"
    assert emitted[-1]["status"] == "interrupting"


def test_steering_request_replay_does_not_duplicate_user_update_or_interrupt(service, tmp_path, monkeypatch):
    project = tmp_path / "idempotent-steering-project"
    project.mkdir()
    state = service.sessions.create(str(project), "model-a:latest", 4096)
    state["task_checkpoint"] = worker.begin_task(None, prompt="Build the feature", turn_id="turn-steer",
                                                workspace=str(project), settings={})
    state["run_state"] = {"status": "running", "turn_id": "turn-steer", "safe_messages": []}
    interrupt = threading.Event()
    controller = {"session": state, "checkpoint_lock": threading.RLock(), "accepting_steering": True,
                  "pending_steers": [], "turn_id": "turn-steer", "inference_active": True,
                  "steering_interrupt": interrupt}
    service.active = controller
    emitted = []
    monkeypatch.setattr(service, "emit", emitted.append)
    request = {"sessionId": state["session_id"], "workspace": str(project),
               "prompt": "Implement the agreed change", "clientRequestId": "steer-request-1"}

    first = service.handle("session_steer", request)
    interrupt.clear()
    replay = service.handle("session_steer", request)

    updates = state["task_checkpoint"]["current"]["user_updates"]
    assert len(updates) == 1
    assert updates[0]["id"] == first["updateId"] == replay["updateId"]
    assert replay["deduplicated"] is True
    assert replay["status"] == first["status"] == "interrupting"
    assert not interrupt.is_set(), "replaying an already accepted steer must not interrupt the provider again"
    assert len([event for event in emitted if event.get("type") == "steering_update"]) == 1


def test_steering_request_id_cannot_be_reused_for_different_text(service, tmp_path, monkeypatch):
    project = tmp_path / "steering-request-id-conflict"
    project.mkdir()
    state = service.sessions.create(str(project), "model-a:latest", 4096)
    state["task_checkpoint"] = worker.begin_task(None, prompt="Build the feature", turn_id="turn-steer-conflict",
                                                workspace=str(project), settings={})
    state["run_state"] = {"status": "running", "turn_id": "turn-steer-conflict", "safe_messages": []}
    service.active = {"session": state, "checkpoint_lock": threading.RLock(), "accepting_steering": True,
                      "pending_steers": [], "turn_id": "turn-steer-conflict"}
    monkeypatch.setattr(service, "emit", lambda event: None)
    base = {"sessionId": state["session_id"], "workspace": str(project), "clientRequestId": "steer-request-2"}
    service.handle("session_steer", {**base, "prompt": "First instruction"})

    with pytest.raises(ValueError, match="already used for different steering text"):
        service.handle("session_steer", {**base, "prompt": "Different instruction"})


def test_steering_messages_are_delivered_in_order_before_same_task_continues(service, tmp_path, monkeypatch):
    events = []
    service.emit = events.append
    started = threading.Event()
    deliver = threading.Event()
    captured = {}

    class BoundaryEngine:
        def __init__(self, root, model, context, access, approval, event, approve, **kwargs):
            captured.update(root=Path(root).resolve(), model=model, context=context,
                            access=access, approval=approval, steering=kwargs["steering_handler"])
            self.event = event
            self.state = {}
            self.runtime = object()

        def run(self, prompt, messages):
            messages.append({"role": "user", "content": prompt})
            started.set()
            assert deliver.wait(2)
            assert captured["steering"](messages, finishing=False)
            self.event({"type": "complete", "workflowOutcome": "discussion",
                        "verification": {"status": "not_verified"}})
            return messages

        def cancel(self):
            deliver.set()

    monkeypatch.setattr(worker, "AgentEngine", BoundaryEngine)
    project = tmp_path / "steering-boundary-project"
    project.mkdir()
    service.handle("run_start", {"options": {
        "workspace": str(project), "prompt": "Build the feature", "model": "model-a:latest",
        "context": 4096, "maxTokens": 128, "temperature": 0.2,
        "access": "ask", "approvalMode": "per-action",
    }})
    controller = service.active
    assert controller is not None
    assert started.wait(2)
    assert controller["session"]["plan"] == []
    assert not any(event.get("type") == "plan" for event in events), "a plan event must come from an actual model plan update"
    session_id = controller["session"]["session_id"]
    turn_id = controller["turn_id"]

    first = service.handle("session_steer", {
        "sessionId": session_id, "workspace": str(project), "prompt": "Keep the current layout",
    })
    second = service.handle("session_steer", {
        "sessionId": session_id, "workspace": str(project), "prompt": "Add a mobile check",
    })
    deliver.set()
    controller["thread"].join(3)

    saved = service.sessions.load(session_id)
    updates = [row for row in saved["messages"] if row.get("steering_id")]
    assert [row["content"] for row in updates] == ["Keep the current layout", "Add a mobile check"]
    assert all(row["turn_id"] == turn_id for row in updates)
    checkpoint_updates = saved["task_checkpoint"]["current"]["user_updates"]
    assert [row["status"] for row in checkpoint_updates] == ["delivered", "delivered"]
    assert [row["id"] for row in checkpoint_updates] == [first["updateId"], second["updateId"]]
    assert captured["root"] == project.resolve()
    assert captured["approval"] == "per-action"
    assert saved["run_state"]["status"] == "completed"
    assert [event["status"] for event in events if event.get("type") == "steering_update"] == [
        "accepted", "accepted", "delivered", "delivered",
    ]


def test_session_run_settings_persist_skill_controls_and_inference_values(service, tmp_path):
    workspace = tmp_path / "skill-settings-project"
    workspace.mkdir()
    session = service.sessions.create(str(workspace), "model-a:latest", 65536)

    saved = service.handle("session_run_settings", {
        "sessionId": session["session_id"],
        "settings": {
            "model": "model-a:latest", "context": 65536, "maxTokens": 8192,
            "temperature": 0.2, "access": "ask", "approvalMode": "per-action",
            "keepAlive": "30m", "reasoning": None, "reasoningBudgetTokens": 65536,
            "harnessProfile": "small-model", "taskIntent": "implement",
            "skillsEnabled": False, "skillSources": ["project"],
        },
    })

    assert saved["skills_enabled"] is False
    assert saved["skill_sources"] == ["project"]
    assert saved["context"] == 65536
    assert saved["max_tokens"] == 8192
    assert saved["reasoning_budget_tokens"] == 65536
    assert saved["task_intent"] == "implement"
    assert service.sessions.load(session["session_id"], str(workspace))["state"]["skills_enabled"] is False


def test_switching_away_from_session_approval_revokes_saved_chat_grant(service, tmp_path):
    workspace = tmp_path / "revoke-chat-approval"
    workspace.mkdir()
    session = service.sessions.create(str(workspace), "model-a:latest", 4096)
    session["session_approval_granted"] = True
    service.sessions.save(session)
    settings = {
        "model": "model-a:latest", "context": 4096, "maxTokens": 1024,
        "temperature": 0.2, "access": "ask", "approvalMode": "per-action",
        "keepAlive": "30m", "reasoning": None, "harnessProfile": "standard", "taskIntent": "auto",
        "skillsEnabled": True, "skillSources": ["project", "user"],
    }

    saved = service.handle("session_run_settings", {"sessionId": session["session_id"], "settings": settings})

    assert saved["approval_mode"] == "per-action"
    assert saved["session_approval_granted"] is False


def test_permission_rules_are_validated_persisted_and_locked_during_runs(service):
    rules = [
        {"tool": "write_file", "decision": "deny", "path_glob": "generated/**"},
        {"tool": "external_directory", "decision": "ask", "path_glob": "C:/Users/test/shared/**", "workspace": "C:/Users/test/project"},
    ]
    saved = service.handle("permission_rules_set", {"rules": rules})
    assert saved == rules
    assert service.handle("permission_rules_get", {}) == rules
    assert json.loads(service.permission_rules_path.read_text(encoding="utf-8")) == rules
    reloaded = worker.AgentService()
    assert reloaded.handle("permission_rules_get", {}) == rules
    reloaded.mcp.shutdown()
    reloaded.llama.shutdown()

    service.active = {"session": {}}
    with pytest.raises(RuntimeError, match="active run"):
        service.handle("permission_rules_set", {"rules": []})
    assert service.handle("permission_rules_get", {}) == rules


def test_malformed_permission_rules_preserve_file_and_explain_safe_fallback(service):
    service.permission_rules_path.parent.mkdir(parents=True, exist_ok=True)
    original = '{"tool":"write_file","decision":"allow"}'
    service.permission_rules_path.write_text(original, encoding="utf-8")

    recovered = worker.AgentService()

    assert recovered.permission_rules == []
    assert "permission rules" in recovered.permission_rules_warning.casefold()
    assert recovered.permission_rules_path.read_text(encoding="utf-8") == original


def test_legacy_global_external_folder_rules_are_disabled_without_discarding_other_rules(service):
    service.permission_rules_path.parent.mkdir(parents=True, exist_ok=True)
    original = json.dumps([
        {"tool": "write_file", "decision": "deny", "path_glob": "generated/**"},
        {"tool": "external_directory", "decision": "allow", "path_glob": "C:/Users/test/shared/**"},
    ])
    service.permission_rules_path.write_text(original, encoding="utf-8")

    recovered = worker.AgentService()

    assert recovered.permission_rules == [{"tool": "write_file", "decision": "deny", "path_glob": "generated/**"}]
    assert "legacy external-folder permission" in recovered.permission_rules_warning
    assert recovered.permission_rules_path.read_text(encoding="utf-8") == original
    recovered.mcp.shutdown()
    recovered.llama.shutdown()
    recovered.mcp.shutdown()
    recovered.llama.shutdown()


def test_provider_request_settings_update_the_matching_prompt_activity_and_stream_live(service, tmp_path, monkeypatch):
    events = []
    service.emit = events.append

    class RequestEvidenceEngine:
        def __init__(self, root, model, context, access, approval, event, approve, **kwargs):
            self.event = event
            self.state = {}
            self.runtime = object()

        def run(self, prompt, messages):
            self.event({"type": "prompt_manifest", "activityId": "turn-1-request-1", "request_index": 1,
                        "messages": [], "configured_context": 65536})
            self.event({"type": "inference_settings", "request_index": 1, "provider": "ollama",
                        "request_api": "/api/chat", "model": "model-a:latest", "api_model": "model-a:latest",
                        "stream": True, "tool_count": 2, "tool_names": ["read_file", "load_tools"],
                        "deferred_tool_names": ["mcp__build__check"], "requested_context": 65536,
                        "max_output_tokens": 8192, "reasoning_override": None,
                        "reasoning_budget_tokens": 2048,
                        "reasoning_field_sent": True, "reasoning_override": "high", "keep_alive": "30m",
                        "request_options": {"num_ctx": 65536, "num_predict": 8192},
                        "additional_fields": {"think": "high"},
                        "estimated_input_tokens": 600, "input_estimate_method": "conservative estimate"})
            self.event({"type": "request_dispatched", "request_index": 1})
            self.event({"type": "request_headers", "request_index": 1, "http_status": 200,
                        "http_reason": "OK", "header_wait_seconds": 0.75})
            self.event({"type": "generation_usage", "request_index": 1,
                        "usage": {"prompt_eval_count": 580, "prompt_eval_cached_count": 120, "eval_count": 45}})
            self.event({"type": "request_complete", "request_index": 1, "provider_done": True,
                        "provider_done_reason": "length"})
            self.event({"type": "generation_complete", "workflowOutcome": "discussion",
                        "verification": {"status": "not_verified", "steps": []}})
            return messages

        def cancel(self):
            pass

    monkeypatch.setattr(worker, "AgentEngine", RequestEvidenceEngine)
    project = tmp_path / "request-evidence-project"
    project.mkdir()
    service.handle("run_start", {"options": {
        "workspace": str(project), "prompt": "hello", "model": "model-a:latest",
        "context": 65536, "maxTokens": 8192, "temperature": 0.2,
        "access": "ask", "approvalMode": "per-action", "reasoning": None, "reasoningBudgetTokens": 2048,
    }})
    controller = service.active
    assert controller is not None
    controller["thread"].join(3)

    saved = service.sessions.load(controller["session"]["session_id"], str(project))["state"]
    prompt = next(row for row in saved["activity_events"] if row.get("kind") == "prompt")
    assert prompt["providerRequest"]["request_options"] == {"num_ctx": 65536, "num_predict": 8192}
    assert prompt["providerRequest"]["reasoning_field_sent"] is True
    assert prompt["providerRequest"]["additional_fields"] == {"think": "high"}
    assert prompt["providerRequest"]["api_model"] == "model-a:latest"
    assert prompt["providerRequest"]["reasoning_budget_tokens"] == 2048
    assert saved["reasoning_budget_tokens"] == 2048
    assert prompt["providerRequest"]["tool_count"] == 2
    assert prompt["providerUsage"] == {"prompt_eval_count": 580, "prompt_eval_cached_count": 120, "eval_count": 45}
    assert prompt["status"] == "response_stream_ended"
    assert prompt["providerRequest"]["http_status"] == 200
    assert prompt["providerRequest"]["header_wait_seconds"] == 0.75
    assert prompt["providerRequest"]["provider_done_reason"] == "length"
    assert any(event.get("type") == "inference_settings" for event in events)
    prompt_activity = next(item for item in controller["session"]["activity_events"] if item.get("kind") == "prompt")
    assert prompt_activity["providerRequest"]["tool_names"] == ["read_file", "load_tools"]
    assert prompt_activity["providerRequest"]["deferred_tool_names"] == ["mcp__build__check"]
    assert any(event.get("type") == "request_headers" and event.get("http_status") == 200 for event in events)
    assert any(event.get("type") == "activity_event" and event.get("activity", {}).get("providerRequest")
               for event in events)
    assert any(event.get("type") == "activity_event"
               and event.get("activity", {}).get("status") == "response_stream_ended" for event in events)


def test_plan_intent_seeds_live_checklist_and_enforces_read_only_builtin_tools(service, tmp_path, monkeypatch):
    events = []
    captured = {}
    service.emit = events.append
    service.permission_rules = [{"tool": "write_file", "decision": "deny"}]
    service.mcp_tools = [{"type": "function", "function": {"name": "mcp__mutating_tool", "parameters": {"type": "object"}}}]

    class CapturingEngine:
        def __init__(self, root, model, context, access, approval, event, approve, **kwargs):
            captured.update(access=access, kwargs=kwargs)
            self.event = event
            self.state = {}
            self.runtime = object()

        def run(self, prompt, messages):
            self.event({"type": "complete", "workflowOutcome": "plan_only",
                        "verification": {"status": "not_verified", "steps": []}})
            return messages

        def cancel(self):
            pass

    monkeypatch.setattr(worker, "AgentEngine", CapturingEngine)
    project = tmp_path / "plan-intent-project"
    project.mkdir()
    other_project = tmp_path / "other-project"
    other_project.mkdir()
    matching_external_rule = {"tool": "external_directory", "decision": "ask",
                              "path_glob": "C:/Users/test/shared/**", "workspace": str(project)}
    other_external_rule = {"tool": "external_directory", "decision": "allow",
                           "path_glob": "C:/Users/test/shared/**", "workspace": str(other_project)}
    service.permission_rules.extend([matching_external_rule, other_external_rule])
    service.handle("run_start", {"options": {
        "workspace": str(project), "prompt": "Plan a settings screen", "model": "model-a:latest",
        "context": 4096, "maxTokens": 128, "temperature": 0.2,
        "access": "edit", "approvalMode": "per-action", "taskIntent": "plan",
    }})
    controller = service.active
    assert controller is not None
    session_id = controller["session"]["session_id"]
    controller["thread"].join(3)

    saved = service.sessions.load(session_id)
    assert captured["access"] == "plan"
    assert captured["kwargs"]["task_intent"] == "plan"
    assert captured["kwargs"]["mcp_tools"] == []
    run_rules = [service.permission_rules[0], {**matching_external_rule, "workspace": str(project).replace("\\", "/")}]
    assert captured["kwargs"]["permission_rules"] == run_rules
    assert captured["kwargs"]["permission_workspace_root"] == project
    assert saved["run_state"]["settings"]["permission_rules"] == run_rules
    assert saved["task_intent"] == "plan"
    assert saved["plan"][0]["title"] == "Use the task brief and project instructions as the objective"
    assert saved["task_checkpoint"]["current"]["acceptance_criteria_source"] == "awaiting_agent_refinement"
    plan_activity = next(event["activity"] for event in events if event.get("type") == "activity_event" and event.get("activity", {}).get("kind") == "plan")
    assert plan_activity["acceptanceCriteria"] == []
    assert plan_activity["taskMode"] == "plan"
    assert saved["turns"][-1]["settings"]["task_intent"] == "plan"
    assert saved["turns"][-1]["settings"]["effective_access"] == "plan"
    assert any(event.get("type") == "activity_event" and event.get("activity", {}).get("kind") == "plan" for event in events)


def test_copy_run_keeps_external_folder_grants_bound_to_original_project(service, tmp_path, monkeypatch):
    captured = {}
    service.permission_rules = []

    class CapturingEngine:
        def __init__(self, root, model, context, access, approval, event, approve, **kwargs):
            captured.update(root=Path(root), access=access, kwargs=kwargs)
            self.event = event
            self.state = {}
            self.runtime = object()

        def run(self, prompt, messages):
            self.event({"type": "complete", "workflowOutcome": "completed"})
            return messages

        def cancel(self):
            pass

    monkeypatch.setattr(worker, "AgentEngine", CapturingEngine)
    project = tmp_path / "copy-source-project"
    other_project = tmp_path / "other-source-project"
    project.mkdir(); other_project.mkdir()
    (project / "README.md").write_text("fixture", encoding="utf-8")
    matching = {"tool": "external_directory", "decision": "ask", "path_glob": "C:/Users/test/shared/**", "workspace": str(project)}
    unrelated = {"tool": "external_directory", "decision": "allow", "path_glob": "C:/Users/test/shared/**", "workspace": str(other_project)}
    service.permission_rules = [matching, unrelated]

    service.handle("run_start", {"options": {
        "workspace": str(project), "prompt": "Implement the requested task", "model": "model-a:latest",
        "context": 4096, "maxTokens": 128, "temperature": 0.2,
        "access": "copy", "approvalMode": "per-action", "taskIntent": "implement",
    }})
    controller = service.active
    assert controller is not None
    controller["thread"].join(3)

    assert captured["access"] == "copy"
    assert captured["root"] == Path(controller["working"])
    assert captured["root"] != project
    assert captured["kwargs"]["permission_workspace_root"] == project
    assert captured["kwargs"]["permission_rules"] == [{**matching, "workspace": str(project).replace("\\", "/")}]


def test_copy_run_journals_prompt_events_to_the_original_project_mirror(service, tmp_path, monkeypatch):
    class PromptEvidenceEngine:
        def __init__(self, root, model, context, access, approval, event, approve, **kwargs):
            self.event = event
            self.state = {}
            self.runtime = object()

        def run(self, prompt, messages):
            self.event({"type": "prompt_manifest", "request_index": 1,
                        "messages": [{"role": "user", "content": prompt}]})
            self.event({"type": "request_dispatched", "provider": "ollama", "request_index": 1})
            self.event({"type": "request_error", "provider": "ollama", "request_index": 1,
                        "phase": "waiting_response_headers", "cancelled": True,
                        "error": "Cancelled before response headers."})
            raise worker.RequestCancelled()

        def cancel(self):
            pass

    monkeypatch.setattr(worker, "AgentEngine", PromptEvidenceEngine)
    project = tmp_path / "copy-journal-source-project"
    project.mkdir()
    service.handle("run_start", {"options": {
        "workspace": str(project), "prompt": "Inspect the project", "model": "model-a:latest",
        "context": 4096, "maxTokens": 128, "temperature": 0.2,
        "access": "copy", "approvalMode": "per-action", "taskIntent": "implement",
    }})
    controller = service.active
    assert controller is not None
    controller["thread"].join(3)

    session_id = controller["session"]["session_id"]
    project_journal = project / ".agent-workbench" / "sessions" / f"{session_id}.events.jsonl"
    app_journal = service.sessions.app.root / f"{session_id}.events.jsonl"
    assert project_journal.is_file()
    project_events = [json.loads(line)["event"] for line in project_journal.read_text(encoding="utf-8").splitlines()]
    app_events = [json.loads(line)["event"] for line in app_journal.read_text(encoding="utf-8").splitlines()]
    assert [event["type"] for event in project_events] == [event["type"] for event in app_events]
    assert any(event["type"] == "prompt_manifest" for event in project_events)
    assert any(event["type"] == "request_dispatched" for event in project_events)
    assert not (Path(controller["working"]) / ".agent-workbench" / "sessions" / f"{session_id}.events.jsonl").exists()


def test_agent_plan_decisions_are_saved_to_checkpoint_and_activity(service, tmp_path, monkeypatch):
    project = tmp_path / "plan-decision-project"
    project.mkdir()
    state = service.sessions.create(str(project), "model-a:latest", 4096)
    state["task_checkpoint"] = {"current": {"plan": [], "decisions": []}}
    service.sessions.save(state)
    controller = {"session": state, "turn_id": "turn-plan-decision", "checkpoint_lock": threading.RLock(),
                  "last_checkpoint": time.monotonic(), "last_journal_flush": time.monotonic(), "journal_pending": []}
    monkeypatch.setattr(service, "emit", lambda _event: None)
    decision = "Keep the existing router to preserve deep links."

    service._publish_run_event(controller, SimpleNamespace(workspace=project), {
        "type": "plan", "source": "agent", "items": [{"title": "Implement", "status": "in_progress"}],
        "acceptanceCriteria": ["Deep links still work."], "decisions": [decision],
        "taskMode": "implement",
        "progressCheckpoint": {"verifiedFindings": ["The existing router owns deep links."],
                               "completedWork": ["Inspected route configuration."],
                               "pendingWork": ["Add and verify the page route."],
                               "nextAction": "Add the page route."},
    })
    service._publish_run_event(controller, SimpleNamespace(workspace=project), {
        "type": "plan", "source": "agent", "items": [{"title": "Implement", "status": "deferred"}],
        "taskMode": "plan_only",
    })

    saved = service.sessions.load(state["session_id"], str(project))["state"]
    assert saved["task_checkpoint"]["current"]["decisions"][0]["text"] == decision
    assert saved["task_checkpoint"]["current"]["task_mode"] == "plan_only"
    assert saved["task_checkpoint"]["current"]["plan_source"] == "agent"
    plan_activities = [row for row in saved["activity_events"] if row.get("kind") == "plan"]
    assert plan_activities[0]["decisions"] == [decision]
    assert plan_activities[0]["progressCheckpoint"]["nextAction"] == "Add the page route."
    assert plan_activities[0]["taskMode"] == "implement"
    assert plan_activities[1]["taskMode"] == "plan_only"


def test_completed_operation_is_not_published_until_both_journals_save(service, tmp_path, monkeypatch):
    project = tmp_path / "completion-durability-project"
    project.mkdir()
    state = service.sessions.create(str(project), "model-a:latest", 8192)
    controller = {"session": state, "turn_id": "turn-durable", "checkpoint_lock": threading.RLock(),
                  "last_checkpoint": time.monotonic(), "last_journal_flush": time.monotonic(),
                  "journal_pending": []}
    order = []

    def append_events(_session_id, _workspace, rows):
        order.append(("journal", [row["type"] for row in rows]))
        return {"app_saved": True, "project_saved": True, "error": None}

    monkeypatch.setattr(service.sessions, "append_events", append_events)
    monkeypatch.setattr(service, "emit", lambda event: order.append(("emit", event.get("type"),
        (event.get("activity") or {}).get("status"), (event.get("activity") or {}).get("result"))))

    service._publish_run_event(controller, SimpleNamespace(workspace=project), {
        "type": "tool_start", "operationId": "op-1", "toolCallId": "call-1",
        "name": "write_file", "arguments": {"path": "src/new.py"}, "startedAt": 1,
    })
    order.clear()
    service._publish_run_event(controller, SimpleNamespace(workspace=project), {
        "type": "tool_done", "operationId": "op-1", "toolCallId": "call-1",
        "name": "write_file", "result": "Updated: src/new.py", "status": "completed",
        "affectedFiles": ["src/new.py"], "completedAt": 2,
    })

    journal_index = next(index for index, row in enumerate(order) if row[0] == "journal")
    completion_index = next(index for index, row in enumerate(order)
                            if row[0] == "emit" and row[1] == "activity_event"
                            and row[2] == "completed" and row[3] == "Updated: src/new.py")
    assert journal_index < completion_index


def test_due_context_checkpoint_prompt_forces_immediate_session_snapshot(service, tmp_path, monkeypatch):
    project = tmp_path / "context-checkpoint-project"
    project.mkdir()
    state = service.sessions.create(str(project), "model-a:latest", 8192)
    state["task_checkpoint"] = {"current": {"task_id": "task-pressure", "context_checkpoint": {
        "armed": True, "due": True, "acknowledged": False,
    }}}
    snapshots = []
    def save_snapshot(controller):
        snapshots.append(copy.deepcopy(controller["session"]))
        return {"app_saved": True, "project_saved": True, "error": None}

    monkeypatch.setattr(service, "_save_active_session", save_snapshot)
    monkeypatch.setattr(service.sessions, "append_events", lambda *_args: {
        "app_saved": True, "project_saved": True, "error": None,
    })
    monkeypatch.setattr(service, "emit", lambda _event: None)
    controller = {"session": state, "turn_id": "turn-pressure", "checkpoint_lock": threading.RLock(),
                  "last_checkpoint": time.monotonic(), "last_journal_flush": time.monotonic(),
                  "journal_pending": []}

    service._publish_run_event(controller, SimpleNamespace(workspace=project), {
        "type": "prompt_manifest", "activityId": "turn-pressure-request-1", "request_index": 1,
        "estimated_request_input_tokens": 7000, "input_budget": 10000,
        "context_checkpoint_due": True, "context_checkpoint_threshold_ratio": 0.70,
        "context_checkpoint_reset_ratio": 0.60, "context_checkpoint_ratio": 0.70,
        "context_checkpoint_acknowledged": False,
    })

    assert len(snapshots) == 1
    assert snapshots[0]["task_checkpoint"]["current"]["context_checkpoint"]["due"] is True

    service._publish_run_event(controller, SimpleNamespace(workspace=project), {
        "type": "progress_checkpoint", "progressCheckpoint": {
            "verifiedFindings": ["saved finding"], "completedWork": [],
            "pendingWork": ["continue"], "nextAction": "continue the task",
        },
    })

    assert len(snapshots) == 2
    assert snapshots[1]["activity_events"][-1]["kind"] == "context_checkpoint"
    assert snapshots[1]["activity_events"][-1]["progressCheckpoint"]["nextAction"] == "continue the task"


def test_session_run_settings_cannot_change_during_active_run(service, tmp_path):
    workspace = tmp_path / "busy-project"
    workspace.mkdir()
    session = service.sessions.create(str(workspace), "model-a:latest", 65536)
    service.active = {"session": session}

    with pytest.raises(RuntimeError, match="active"):
        service.handle("session_run_settings", {"sessionId": session["session_id"], "settings": {}})


def test_session_live_snapshot_returns_full_active_state_for_the_captured_workspace(service, tmp_path):
    workspace = tmp_path / "live-snapshot-project"
    workspace.mkdir()
    session = service.sessions.create(str(workspace), "model-a:latest", 65536)
    full_output = "complete operation output " * 900
    session.update(
        plan=[{"title": "Inspect", "status": "completed"}, {"title": "Implement", "status": "in_progress"}],
        acceptance_criteria=["The saved plan remains visible while inference continues."],
        activity_events=[{"id": "op-1", "turnId": "turn-1", "sessionId": session["session_id"],
                          "workspace": str(workspace), "kind": "operation", "name": "run_command",
                          "status": "running", "output": {"stdout": full_output}}],
        run_state={"status": "running", "turn_id": "turn-1", "started_at": 123.0,
                   "phase": "reasoning", "partial_content": "", "partial_thinking": "working through the next step"},
    )
    service.active = {
        "session": session, "source": workspace, "turn_id": "turn-1",
        "checkpoint_lock": threading.RLock(), "activity_revision": 7, "text_revision": 1,
        "live_thinking": "working through the next step", "live_content": "",
    }

    snapshot = service.handle("session_live_snapshot", {"sessionId": session["session_id"], "workspace": str(workspace)})

    assert snapshot["active"] is True
    assert snapshot["sessionId"] == session["session_id"]
    assert snapshot["turnId"] == "turn-1"
    assert snapshot["workspace"] == str(workspace)
    assert snapshot["activityRevision"] == 7
    assert snapshot["plan"] == session["plan"]
    assert snapshot["acceptanceCriteria"] == session["acceptance_criteria"]
    assert snapshot["activities"][0]["output"]["stdout"] == full_output
    assert snapshot["runState"]["phase"] == "reasoning"
    assert snapshot["liveAssistant"]["thinking"] == "working through the next step"


def test_first_non_plan_tool_timing_is_saved_once_and_included_in_live_snapshot(service, tmp_path, monkeypatch):
    workspace = tmp_path / "first-operation-project"
    workspace.mkdir()
    session = service.sessions.create(str(workspace), "model-a:latest", 4096)
    session["run_state"] = {"status": "running", "turn_id": "turn-first-operation", "started_at": 1000.0,
                            "phase": "reasoning", "first_operation_seconds": None}
    service.sessions.save(session)
    controller = {"session": session, "source": workspace, "turn_id": "turn-first-operation",
                  "checkpoint_lock": threading.RLock(), "last_checkpoint": time.monotonic() - 20,
                  "last_journal_flush": time.monotonic(), "journal_pending": [], "activity_revision": 0,
                  "text_revision": 0, "live_content": "", "live_thinking": ""}
    service.active = controller
    events = []
    monkeypatch.setattr(service, "emit", events.append)
    turn = SimpleNamespace(workspace=workspace)

    service._publish_run_event(controller, turn, {"type": "tool_start", "operationId": "plan-op",
                                 "toolCallId": "plan-call", "name": "update_plan", "startedAt": 1005.0})
    assert session["run_state"].get("first_operation_seconds") is None
    service._publish_run_event(controller, turn, {"type": "tool_start", "operationId": "read-op",
                                 "toolCallId": "read-call", "name": "read_file", "startedAt": 1042.0})
    service._publish_run_event(controller, turn, {"type": "tool_start", "operationId": "search-op",
                                 "toolCallId": "search-call", "name": "search_files", "startedAt": 1090.0})
    service._publish_run_event(controller, turn, {"type": "tool_start", "operationId": "write-op",
                                 "toolCallId": "write-call", "name": "write_file", "startedAt": 1049.0})
    service._publish_run_event(controller, turn, {"type": "tool_done", "operationId": "write-op",
                                 "toolCallId": "write-call", "name": "write_file", "status": "completed",
                                 "result": "Wrote src/app.tsx", "affectedFiles": ["src/app.tsx"],
                                 "startedAt": 1049.0, "completedAt": 1054.0})

    assert session["run_state"]["first_operation_seconds"] == 42.0
    assert session["run_state"]["first_file_write_seconds"] == 54.0
    assert any(event.get("type") == "activity_event" and event.get("firstOperationSeconds") == 42.0 for event in events)
    assert any(event.get("type") == "activity_event" and event.get("firstFileWriteSeconds") == 54.0 for event in events)
    snapshot = service.handle("session_live_snapshot", {"sessionId": session["session_id"], "workspace": str(workspace)})
    assert snapshot["runState"]["first_operation_seconds"] == 42.0
    assert snapshot["runState"]["first_file_write_seconds"] == 54.0

    other_workspace = tmp_path / "different-project"
    other_workspace.mkdir()
    mismatch = service.handle("session_live_snapshot", {
        "sessionId": session["session_id"], "workspace": str(other_workspace),
    })
    assert mismatch == {"active": False, "sessionId": session["session_id"]}


def test_session_live_snapshot_does_not_expose_state_without_matching_active_run(service, tmp_path):
    workspace = tmp_path / "idle-project"
    workspace.mkdir()
    session = service.sessions.create(str(workspace), "model-a:latest", 65536)
    service.active = None

    snapshot = service.handle("session_live_snapshot", {
        "sessionId": session["session_id"], "workspace": str(workspace),
    })

    assert snapshot == {"active": False, "sessionId": session["session_id"], "workspace": str(workspace)}


def test_session_live_snapshot_restores_saved_terminal_transcript_after_active_controller_is_gone(service, tmp_path):
    workspace = tmp_path / "terminal-snapshot-project"
    workspace.mkdir()
    session = service.sessions.create(str(workspace), "model-a:latest", 65536)
    session["messages"] = [{"role": "user", "content": "Build the page"},
                           {"role": "assistant", "content": "The finished answer."}]
    session["turns"] = [{"turn_id": "turn-done", "transcript_saved": True}]
    session["run_state"] = {"status": "completed", "turn_id": "turn-done", "workflow_outcome": "implementation_unverified"}
    session["plan"] = [{"title": "Build", "status": "completed"}]
    service.sessions.save(session)
    service.active = None

    snapshot = service.handle("session_live_snapshot", {
        "sessionId": session["session_id"], "workspace": str(workspace),
    })

    assert snapshot["active"] is False
    assert snapshot["runState"]["status"] == "completed"
    assert snapshot["plan"] == session["plan"]
    assert snapshot["savedTranscript"]["messages"] == session["messages"]


def test_live_snapshot_text_revisions_reset_request_buffers_and_reconcile_late_stream_events(service, tmp_path, monkeypatch):
    workspace = tmp_path / "request-buffer-project"
    workspace.mkdir()
    session = service.sessions.create(str(workspace), "model-a:latest", 65536)
    session["run_state"] = {
        "status": "running", "turn_id": "turn-1", "started_at": time.time(), "prompt": "Build it",
        "safe_messages": [], "partial_content": "", "partial_thinking": "", "active_operation": None,
    }
    controller = {
        "session": session, "source": workspace, "turn_id": "turn-1", "checkpoint_lock": threading.RLock(),
        "last_checkpoint": time.monotonic(), "last_journal_flush": time.monotonic(), "journal_pending": [],
        "activity_revision": 0, "text_revision": 0, "live_content": "", "live_thinking": "",
    }
    service.active = controller
    emitted = []
    monkeypatch.setattr(service, "emit", emitted.append)
    turn = SimpleNamespace(workspace=workspace)

    service._publish_run_event(controller, turn, {"type": "phase", "phase": "waiting"})
    service._publish_run_event(controller, turn, {"type": "thinking", "text": "Planning this request."})
    first = service.handle("session_live_snapshot", {
        "sessionId": session["session_id"], "workspace": str(workspace), "afterTextRevision": 0,
    })
    service._publish_run_event(controller, turn, {"type": "phase", "phase": "waiting"})
    second = service.handle("session_live_snapshot", {
        "sessionId": session["session_id"], "workspace": str(workspace), "afterTextRevision": first["textRevision"],
    })
    service._publish_run_event(controller, turn, {"type": "text", "text": "Next request output."})

    assert first["liveAssistant"]["thinking"] == "Planning this request."
    assert second["textRevision"] > first["textRevision"]
    assert second["liveAssistant"] == {"content": "", "thinking": ""}
    assert emitted[-1]["textRevision"] == second["textRevision"] + 1


def test_event_persistence_does_not_hold_checkpoint_lock_while_mirror_is_slow(service, tmp_path, monkeypatch):
    workspace = tmp_path / "slow-mirror-project"
    workspace.mkdir()
    session = service.sessions.create(str(workspace), "model-a:latest", 65536)
    session["run_state"] = {"status": "running", "turn_id": "turn-slow-mirror", "started_at": time.time(),
                            "safe_messages": [], "partial_content": "", "partial_thinking": "",
                            "active_operations": {}}
    checkpoint_lock = threading.RLock()
    controller = {"session": session, "source": workspace, "turn_id": "turn-slow-mirror",
                  "checkpoint_lock": checkpoint_lock, "last_checkpoint": time.monotonic() - 10,
                  "last_journal_flush": time.monotonic(), "journal_pending": [],
                  "activity_revision": 0, "text_revision": 0, "live_content": "", "live_thinking": ""}
    service.active = controller
    mirror_started = threading.Event()
    release_mirror = threading.Event()
    original_append = service.sessions.append_events

    def slow_append(*args, **kwargs):
        mirror_started.set()
        assert release_mirror.wait(2)
        return original_append(*args, **kwargs)

    monkeypatch.setattr(service.sessions, "append_events", slow_append)
    monkeypatch.setattr(service, "emit", lambda _event: None)
    turn = SimpleNamespace(workspace=workspace)
    publish = threading.Thread(target=service._publish_run_event, args=(controller, turn, {
        "type": "tool_start", "operationId": "operation-1", "name": "read_file",
        "arguments": {"path": "src/app.ts"}, "startedAt": time.time(),
    }))
    publish.start()
    try:
        assert mirror_started.wait(2)
        assert checkpoint_lock.acquire(blocking=False), "slow mirrored persistence held the task checkpoint lock"
        checkpoint_lock.release()
    finally:
        release_mirror.set()
        publish.join(2)

    assert not publish.is_alive()
    saved = service.sessions.load(session["session_id"])
    assert any(row.get("operationId") == "operation-1" for row in saved["activity_events"])


def test_snapshot_persistence_does_not_hold_checkpoint_lock_while_mirror_is_slow(service, tmp_path, monkeypatch):
    workspace = tmp_path / "slow-snapshot-project"
    workspace.mkdir()
    session = service.sessions.create(str(workspace), "model-a:latest", 65536)
    session["run_state"] = {"status": "running", "turn_id": "turn-slow-snapshot", "started_at": time.time(),
                            "safe_messages": [], "partial_content": "", "partial_thinking": "",
                            "active_operations": []}
    checkpoint_lock = threading.RLock()
    controller = {"session": session, "source": workspace, "turn_id": "turn-slow-snapshot",
                  "checkpoint_lock": checkpoint_lock, "last_checkpoint": time.monotonic() - 10,
                  "last_journal_flush": time.monotonic(), "journal_pending": [],
                  "activity_revision": 0, "text_revision": 0, "live_content": "", "live_thinking": ""}
    service.active = controller
    save_started = threading.Event()
    release_save = threading.Event()
    original_save = service.sessions.save

    def slow_save(state):
        save_started.set()
        assert release_save.wait(2)
        return original_save(state)

    monkeypatch.setattr(service.sessions, "save", slow_save)
    monkeypatch.setattr(service, "emit", lambda _event: None)
    turn = SimpleNamespace(workspace=workspace)
    publish = threading.Thread(target=service._publish_run_event, args=(controller, turn, {
        "type": "complete", "workflowOutcome": "implemented",
    }))
    publish.start()
    try:
        assert save_started.wait(2)
        assert checkpoint_lock.acquire(blocking=False), "slow mirrored snapshot held the task checkpoint lock"
        checkpoint_lock.release()
    finally:
        release_save.set()
        publish.join(2)

    assert not publish.is_alive()
    saved = service.sessions.load(session["session_id"])
    assert saved["run_state"]["workflow_outcome"] == "implemented"


def test_active_session_saves_cannot_overwrite_a_newer_snapshot(service, tmp_path, monkeypatch):
    workspace = tmp_path / "ordered-snapshot-project"
    workspace.mkdir()
    session = service.sessions.create(str(workspace), "model-a:latest", 65536)
    controller = {"session": session, "checkpoint_lock": threading.RLock()}
    first_save_started = threading.Event()
    release_first_save = threading.Event()
    second_save_started = threading.Event()
    original_save = service.sessions.save

    def ordered_save(snapshot):
        content = snapshot.get("messages", [{}])[0].get("content") if snapshot.get("messages") else ""
        if content == "revision-1":
            first_save_started.set()
            assert release_first_save.wait(2)
        elif content == "revision-2":
            second_save_started.set()
        return original_save(snapshot)

    monkeypatch.setattr(service.sessions, "save", ordered_save)
    session["messages"] = [{"role": "assistant", "content": "revision-1"}]
    first = threading.Thread(target=service._save_active_session, args=(controller,))
    first.start()
    assert first_save_started.wait(2)

    with controller["checkpoint_lock"]:
        session["messages"] = [{"role": "assistant", "content": "revision-2"}]
    second = threading.Thread(target=service._save_active_session, args=(controller,))
    second.start()
    deadline = time.monotonic() + 2
    while controller.get("session_snapshot_revision", 0) < 2 and time.monotonic() < deadline:
        time.sleep(0.005)
    assert controller.get("session_snapshot_revision") == 2
    release_first_save.set()
    first.join(2)
    second.join(2)

    assert not first.is_alive() and not second.is_alive()
    assert second_save_started.is_set()
    saved = service.sessions.load(session["session_id"])
    assert saved["messages"][-1]["content"] == "revision-2"


def test_slow_steering_save_does_not_hold_checkpoint_lock(service, tmp_path, monkeypatch):
    workspace = tmp_path / "slow-steering-project"
    workspace.mkdir()
    session = service.sessions.create(str(workspace), "model-a:latest", 65536)
    checkpoint_lock = threading.RLock()
    controller = {"session": session, "source": workspace, "turn_id": "turn-steer-save",
                  "checkpoint_lock": checkpoint_lock, "accepting_steering": True,
                  "pending_steers": [], "steering_interrupt": threading.Event(), "inference_active": True}
    service.active = controller
    save_started = threading.Event()
    release_save = threading.Event()
    original_save = service.sessions.save

    def slow_save(snapshot):
        save_started.set()
        assert release_save.wait(2)
        return original_save(snapshot)

    monkeypatch.setattr(service.sessions, "save", slow_save)
    result: list[dict] = []
    steer = threading.Thread(target=lambda: result.append(service._accept_session_steer({
        "sessionId": session["session_id"], "workspace": str(workspace), "prompt": "Keep the existing plan and implement the next step.",
    })))
    steer.start()
    try:
        assert save_started.wait(2)
        assert checkpoint_lock.acquire(blocking=False), "slow steering persistence held the active task lock"
        checkpoint_lock.release()
    finally:
        release_save.set()
        steer.join(2)

    assert not steer.is_alive()
    assert result[0]["accepted"] is True
    assert controller["steering_interrupt"].is_set()


def test_waiting_request_does_not_interrupt_before_steering_is_durable(service, tmp_path, monkeypatch):
    workspace = tmp_path / "steering-durability-project"
    workspace.mkdir()
    session = service.sessions.create(str(workspace), "model-a:latest", 65536)
    interrupt = threading.Event()
    controller = {"session": session, "source": workspace, "turn_id": "turn-steer-durable",
                  "checkpoint_lock": threading.RLock(), "last_checkpoint": time.monotonic(),
                  "last_journal_flush": time.monotonic(), "journal_pending": [],
                  "activity_revision": 0, "text_revision": 0, "live_content": "", "live_thinking": "",
                  "steering_interrupt": interrupt, "steering_persisting": True,
                  "pending_steers": [{"id": "pending", "instruction": "continue"}]}
    monkeypatch.setattr(service, "emit", lambda _event: None)
    service._publish_run_event(controller, SimpleNamespace(workspace=workspace), {"type": "phase", "phase": "waiting"})
    assert not interrupt.is_set(), "the provider request was interrupted before the steering update was durable"


def test_steering_dispatch_does_not_block_cancel_from_sidecar_input(service, monkeypatch):
    save_started = threading.Event()
    release_save = threading.Event()
    original_dispatch = service.dispatch
    cancel_processed = threading.Event()
    responses = []

    def slow_steer(_message):
        save_started.set()
        assert release_save.wait(2)
        responses.append("steer")
        return False

    def dispatch(message):
        if message.get("command") == "session_steer":
            return slow_steer(message)
        if message.get("command") == "run_cancel":
            responses.append("cancel")
            cancel_processed.set()
            return False
        return original_dispatch(message)

    monkeypatch.setattr(service, "dispatch", dispatch)
    monkeypatch.setattr(worker, "AgentService", lambda: service)
    monkeypatch.setattr(worker.sys, "stdin", io.StringIO(
        '{"command":"session_steer"}\n{"command":"run_cancel","sessionId":"session-a","turnId":"turn-a"}\n'))
    output = io.StringIO()
    monkeypatch.setattr(worker.sys, "stdout", output)

    main_thread = threading.Thread(target=worker.main)
    main_thread.start()
    try:
        assert save_started.wait(2)
        assert cancel_processed.wait(0.25), "the sidecar input loop waited for session steering persistence before reading Cancel"
    finally:
        release_save.set()
        main_thread.join(2)
    assert not main_thread.is_alive()


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


def test_model_info_exposes_boolean_reasoning_toggle_when_ollama_reports_capability_only(service):
    service.runtime.info = {
        "model_info": {"test.context_length": 262144},
        "capabilities": ["completion", "tools", "thinking"],
    }

    result = service.handle("model_info", {"model": "model-a:latest"})

    assert result["reasoning"] == {"support": "toggle", "default": None, "values": [False, True]}


def test_model_info_reports_known_missing_tool_capability(service):
    service.runtime.info = {"model_info": {}, "capabilities": ["completion"]}
    result = service.handle("model_info", {"model": "model-a:latest"})
    assert result["tool_support"] == "unsupported"


def test_tool_catalog_lists_real_tools_and_unimplemented_integrations(service):
    catalog = service.handle("tool_catalog", {})
    names = {item["name"] for item in catalog["tools"]}
    assert {"list_files", "search_files", "read_file", "read_operation_result", "write_file", "edit_file", "apply_patch", "run_command"} <= names
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
    assert info["reasoning"] == {"support": "unknown", "default": None, "values": []}


def test_loaded_gguf_model_info_uses_only_template_reported_reasoning_levels(service, tmp_path):
    model = tmp_path / "model.gguf"
    model.write_bytes(b"fixture")
    registered = service.handle("gguf_register", {"path": str(model)})
    service.llama.status = lambda: {
        "running": True, "model": str(model.resolve()), "context": 32768,
        "reasoning_capability": {"support": "levels", "default": None, "values": [False, "low", "high"]},
    }

    info = service.handle("model_info", {"model": registered["id"]})
    assert info["reasoning"] == {"support": "levels", "default": None, "values": [False, "low", "high"]}
    assert info["effective_context"] == 32768


def test_sessions_are_filtered_by_exact_project_root(service, tmp_path):
    first = tmp_path / "first"
    second = tmp_path / "second"
    first.mkdir(); second.mkdir()
    a = service.handle("session_new", {"workspace": str(first), "model": "model-a:latest", "context": 262144})
    service.handle("session_new", {"workspace": str(second), "model": "model-b:latest", "context": 8192})
    rows = service.handle("sessions_list", {"workspace": str(first)})
    assert [row["session_id"] for row in rows] == [a["session_id"]]
    assert (first / ".agent-workbench" / "sessions" / f"{a['session_id']}.json").is_file()


def test_session_new_preserves_positive_context_below_the_old_minimum(service, tmp_path):
    project = tmp_path / "small-context"
    project.mkdir()
    session = service.handle("session_new", {
        "workspace": str(project), "model": "model-a:latest", "context": 512,
    })
    assert session["context"] == 512


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


def test_corrupt_workspace_history_is_reported_without_being_replaced(service):
    history = service.workspaces.path
    history.parent.mkdir(parents=True, exist_ok=True)
    original = '{"not":"a workspace list"'
    history.write_text(original, encoding="utf-8")

    with pytest.raises(RuntimeError, match="malformed and was preserved"):
        service.handle("workspaces_list", {})

    assert history.read_text(encoding="utf-8") == original


def test_app_session_list_keeps_sessions_when_their_workspace_is_unavailable(service, tmp_path):
    project = tmp_path / "moved-project"
    project.mkdir()
    created = service.handle("session_new", {"workspace": str(project), "model": "model-a:latest", "context": 8192})
    project.rename(tmp_path / "moved-project-away")

    rows = service.handle("sessions_list", {})

    assert rows[0]["session_id"] == created["session_id"]
    assert rows[0]["workspace_available"] is False


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


def test_live_session_view_settings_do_not_overwrite_unsaved_run_progress(service, tmp_path):
    project = tmp_path / "active-session-view-settings"
    project.mkdir()
    state = service.sessions.create(str(project), "model-a:latest", 8192)
    state["messages"].append({"role": "assistant", "content": "Streaming progress is in memory."})
    state["run_state"] = {"status": "running", "turn_id": "turn-live", "partial_content": "new partial output"}
    controller = {"session": state, "checkpoint_lock": threading.RLock(), "turn_id": "turn-live"}
    service.active = controller

    activity_result = service.handle("session_activity_mode", {
        "sessionId": state["session_id"], "activityMode": "sidebar",
    })
    service.handle("session_harness_profile", {
        "sessionId": state["session_id"], "harnessProfile": "small-model",
    })

    saved = service.sessions.load(state["session_id"], str(project))["state"]
    assert activity_result["app_saved"] and activity_result["project_saved"]
    assert saved["activity_mode"] == "sidebar"
    assert saved["harness_profile"] == "small-model"
    assert saved["messages"][-1]["content"] == "Streaming progress is in memory."
    assert saved["run_state"]["partial_content"] == "new partial output"


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


def test_interrupted_recovery_preserves_lone_surrogate_operation_data(service, tmp_path):
    project = tmp_path / "surrogate-recovery-project"
    project.mkdir()
    session = service.sessions.create(str(project), "model-a:latest", 262144)
    invalid_path = "generated-\udc9d.py"
    session["run_state"] = {
        "status": "interrupted", "turn_id": "turn-surrogate", "safe_messages": session["messages"],
        "uncertain_operation": {"name": "write_file", "arguments": {"path": invalid_path}},
    }
    service.sessions.save(session)

    recovered = service.handle("session_recover", {"sessionId": session["session_id"], "action": "resume"})
    reloaded = service.sessions.load(session["session_id"], str(project))["state"]

    assert recovered["uncertain_operation"]["arguments"]["path"] == invalid_path
    assert r"\udc9d" in recovered["prompt"]
    assert reloaded["run_state"]["uncertain_operation"]["arguments"]["path"] == invalid_path


def test_stop_after_operation_command_marks_engine(service):
    class Engine:
        requested = False
        def finish_after_operation(self):
            self.requested = True

    engine = Engine()
    service.active = {"engine": engine, "session": {"session_id": "session-stop"}, "turn_id": "turn-stop"}
    assert service.handle("run_stop_after_operation", {"sessionId": "session-stop", "turnId": "new-turn"}) == {"requested": False, "stale": True}
    assert engine.requested is False
    assert service.handle("run_stop_after_operation", {"sessionId": "session-stop", "turnId": "turn-stop"}) == {"requested": True, "stale": False}
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
    service._publish_run_event(controller, turn, {"type": "tool_progress", "operationId": "op-a",
                                 "progress": {"message": "Scanning files · 256 inspected", "filesScanned": 256},
                                 "timestamp": 1.5})
    service._publish_run_event(controller, turn, {"type": "operation_output", "operationId": "op-a", "stream": "stdout", "text": "full log " * 3000})
    service._publish_run_event(controller, turn, {"type": "tool_done", "operationId": "op-a", "toolCallId": "call-a",
                                 "name": "run_command", "result": "complete result " * 2000, "affectedFiles": [], "completedAt": 2})
    service._publish_run_event(controller, turn, {"type": "tool_start", "operationId": "op-b", "toolCallId": "call-b",
                                 "name": "write_file", "arguments": {"path": "src/a.py"}, "startedAt": 2.5})
    service._publish_run_event(controller, turn, {"type": "tool_progress", "operationId": "op-b",
                                 "progress": {"message": "Writing · 4,194,304 UTF-8 bytes written", "bytesWritten": 4194304, "phase": "writing"},
                                 "timestamp": 2.75})
    service._publish_run_event(controller, turn, {"type": "tool_done", "operationId": "op-b", "toolCallId": "call-b",
                                 "name": "write_file", "result": "second result", "affectedFiles": ["src/a.py"], "completedAt": 3})

    saved = service.sessions.load(state["session_id"])
    activity = next(item for item in saved["activity_events"] if item["operationId"] == "op-a")
    checkpoint_tools = [message for message in saved["run_state"]["safe_messages"] if message.get("role") == "tool"]
    assert len(activity["output"]["stdout"]) > 12000
    assert len(activity["result"]) > 12000
    write_activity = next(item for item in saved["activity_events"] if item["operationId"] == "op-b")
    assert activity["progress"]["filesScanned"] == 256
    assert write_activity["progress"]["bytesWritten"] == 4194304
    assert write_activity["progress"]["phase"] == "writing"
    assert checkpoint_tools[0]["content"] == "complete result " * 2000
    assert checkpoint_tools[1]["content"] == "second result"
    assert sum(message.get("role") == "assistant" and bool(message.get("tool_calls")) for message in saved["run_state"]["safe_messages"]) == 1
    assert any(event["type"] == "activity_event" for event in emitted)
    assert any(event["type"] == "activity_event" and isinstance(event.get("activity"), dict)
               and event["activity"].get("progress", {}).get("bytesWritten") == 4194304 for event in emitted)


def test_parallel_active_reads_are_tracked_and_recovered_individually(service, tmp_path, monkeypatch):
    project = tmp_path / "parallel-read-project"
    project.mkdir()
    state = service.sessions.create(str(project), "model-a:latest", 4096)
    state["run_state"] = {"status": "running", "turn_id": "turn-parallel", "safe_messages": [],
                          "partial_content": "", "partial_thinking": "", "active_operation": None,
                          "active_operations": {}, "tool_batch": None, "completed_tool_results": {}}
    service.sessions.save(state)
    controller = {"session": state, "turn_id": "turn-parallel", "checkpoint_lock": threading.RLock(),
                  "last_checkpoint": time.monotonic(), "last_journal_flush": time.monotonic(), "journal_pending": []}
    monkeypatch.setattr(service, "emit", lambda _event: None)
    turn = SimpleNamespace(workspace=project)
    batch = {"role": "assistant", "tool_calls": [
        {"id": "read-a", "function": {"name": "read_file", "arguments": {"path": "a.py"}}},
        {"id": "read-b", "function": {"name": "read_file", "arguments": {"path": "b.py"}}},
    ]}
    service._publish_run_event(controller, turn, {"type": "tool_batch", "assistantMessage": batch,
                                 "calls": [{"id": "read-a", "name": "read_file"}, {"id": "read-b", "name": "read_file"}]})
    for operation_id, call_id, path in (("op-a", "read-a", "a.py"), ("op-b", "read-b", "b.py")):
        service._publish_run_event(controller, turn, {"type": "tool_start", "operationId": operation_id,
                                     "toolCallId": call_id, "name": "read_file", "arguments": {"path": path}})
    service._publish_run_event(controller, turn, {"type": "tool_done", "operationId": "op-a", "toolCallId": "read-a",
                                 "name": "read_file", "result": "A", "status": "completed"})

    assert set(state["run_state"]["active_operations"]) == {"op-b"}
    assert state["run_state"]["active_operation"]["operationId"] == "op-b"
    checkpoint = service._recovery_checkpoint(state["run_state"])
    tool_results = [message["content"] for message in checkpoint if message.get("role") == "tool"]
    assert tool_results == ["A", "Uncertain: this operation was interrupted and may have partially or fully completed. Inspect the workspace before retrying."]
    service._publish_run_event(controller, turn, {"type": "tool_done", "operationId": "op-b", "toolCallId": "read-b",
                                 "name": "read_file", "result": "read uncertain", "status": "uncertain"})
    assert [item["operationId"] for item in state["run_state"]["uncertain_operations"]] == ["op-b"]


def test_session_recovery_returns_every_uncertain_concurrent_operation(service, tmp_path):
    project = tmp_path / "recover-parallel-project"
    project.mkdir()
    state = service.sessions.create(str(project), "model-a:latest", 4096)
    state["run_state"] = {
        "status": "running", "turn_id": "turn-parallel-recovery", "prompt": "inspect both files",
        "safe_messages": [{"role": "user", "content": "inspect both files"}], "partial_content": "",
        "partial_thinking": "", "active_operation": {"operationId": "op-b", "toolCallId": "read-b", "name": "read_file", "arguments": {"path": "b.py"}},
        "active_operations": {
            "op-a": {"operationId": "op-a", "toolCallId": "read-a", "name": "read_file", "arguments": {"path": "a.py"}},
            "op-b": {"operationId": "op-b", "toolCallId": "read-b", "name": "read_file", "arguments": {"path": "b.py"}},
        },
        "tool_batch": {"assistant_message": {"role": "assistant", "tool_calls": [{"id": "read-a"}, {"id": "read-b"}]},
                       "calls": [{"id": "read-a", "name": "read_file"}, {"id": "read-b", "name": "read_file"}],
                       "base_messages": [{"role": "user", "content": "inspect both files"}]},
        "completed_tool_results": {},
    }
    state["activity_events"] = [
        {"id": "op-a", "operationId": "op-a", "kind": "operation", "name": "read_file", "status": "running"},
        {"id": "op-b", "operationId": "op-b", "kind": "operation", "name": "read_file", "status": "running"},
    ]
    service.sessions.save(state)

    loaded = service.handle("session_resume", {"sessionId": state["session_id"], "workspace": str(project)})
    recovered = service.handle("session_recover", {"sessionId": state["session_id"], "action": "resume"})

    assert [item["operationId"] for item in loaded["run_state"]["uncertain_operations"]] == ["op-a", "op-b"]
    assert [item["status"] for item in loaded["activity_events"]] == ["uncertain", "uncertain"]
    assert [item["operationId"] for item in recovered["uncertain_operations"]] == ["op-a", "op-b"]
    assert '"operationId": "op-a"' in recovered["prompt"]
    assert '"operationId": "op-b"' in recovered["prompt"]


def test_resuming_the_live_session_reattaches_without_marking_it_interrupted(service, tmp_path):
    project = tmp_path / "resume-current-live-session"
    project.mkdir()
    state = service.sessions.create(str(project), "model-a:latest", 8192)
    state["run_state"] = {"status": "running", "turn_id": "turn-live", "partial_content": "saved baseline"}
    service.sessions.save(state)
    state["messages"].append({"role": "assistant", "content": "new live output"})
    state["run_state"]["partial_content"] = "new live output"
    controller = {"session": state, "source": project.resolve(), "working": project.resolve(),
                  "turn_id": "turn-live", "checkpoint_lock": threading.RLock(), "cancel": threading.Event()}
    service.active = controller

    resumed = service.handle("session_resume", {"sessionId": state["session_id"], "workspace": str(project)})

    assert resumed["active_in_process"] is True
    assert resumed["run_state"]["status"] == "running"
    assert resumed["run_state"]["partial_content"] == "new live output"
    assert resumed["messages"][-1]["content"] == "new live output"
    assert service.active is controller
    assert not controller["cancel"].is_set()
    stored = service.sessions.load(state["session_id"], str(project))["state"]
    assert stored["run_state"]["status"] == "running"
    other_project = tmp_path / "resume-wrong-project"
    other_project.mkdir()
    with pytest.raises(ValueError, match="different project"):
        service.handle("session_resume", {"sessionId": state["session_id"], "workspace": str(other_project)})


def test_crash_while_waiting_for_user_marks_question_interrupted_without_fake_uncertain_side_effect(service, tmp_path):
    project = tmp_path / "question-recovery-project"
    project.mkdir()
    state = service.sessions.create(str(project), "model-a:latest", 4096)
    state["run_state"] = {
        "status": "running", "turn_id": "turn-question-recovery", "prompt": "choose a framework",
        "safe_messages": [{"role": "user", "content": "choose a framework"}], "partial_content": "",
        "partial_thinking": "", "active_operation": {"operationId": "op-question", "toolCallId": "call-question", "name": "ask_user"},
        "active_operations": {"op-question": {"operationId": "op-question", "toolCallId": "call-question", "name": "ask_user"}},
        "tool_batch": {"assistant_message": {"role": "assistant", "tool_calls": [{"id": "call-question"}]},
                       "calls": [{"id": "call-question", "name": "ask_user"}],
                       "base_messages": [{"role": "user", "content": "choose a framework"}]},
        "completed_tool_results": {},
    }
    state["activity_events"] = [
        {"id": "op-question", "operationId": "op-question", "kind": "operation", "name": "ask_user", "status": "running"},
        {"id": "q-1", "questionId": "q-1", "operationId": "op-question", "kind": "question",
         "question": "Which framework?", "status": "awaiting_user"},
    ]
    service.sessions.save(state)

    loaded = service.handle("session_resume", {"sessionId": state["session_id"], "workspace": str(project)})
    recovered_tools = [item for item in loaded["run_state"]["safe_messages"] if item.get("role") == "tool"]

    assert [item["status"] for item in loaded["activity_events"]] == ["interrupted", "interrupted"]
    assert loaded["run_state"]["uncertain_operations"] == []
    assert "Ask again only if the answer is still needed" in recovered_tools[0]["content"]


def test_crash_after_user_answer_preserves_answer_in_tool_batch_recovery(service, tmp_path):
    project = tmp_path / "answered-question-recovery-project"
    project.mkdir()
    state = service.sessions.create(str(project), "model-a:latest", 4096)
    state["run_state"] = {
        "status": "running", "turn_id": "turn-answered-question", "prompt": "choose a framework",
        "safe_messages": [{"role": "user", "content": "choose a framework"}], "partial_content": "",
        "partial_thinking": "", "active_operation": {"operationId": "op-question", "toolCallId": "call-question", "name": "ask_user"},
        "active_operations": {"op-question": {"operationId": "op-question", "toolCallId": "call-question", "name": "ask_user"}},
        "tool_batch": {"assistant_message": {"role": "assistant", "tool_calls": [{"id": "call-question"}]},
                       "calls": [{"id": "call-question", "name": "ask_user"}],
                       "base_messages": [{"role": "user", "content": "choose a framework"}]},
        "completed_tool_results": {},
    }
    state["activity_events"] = [
        {"id": "q-answered", "questionId": "q-answered", "operationId": "op-question", "kind": "question",
         "question": "Which framework?", "answer": "React", "status": "answered"},
    ]
    service.sessions.save(state)

    loaded = service.handle("session_resume", {"sessionId": state["session_id"], "workspace": str(project)})
    recovered_tools = [item for item in loaded["run_state"]["safe_messages"] if item.get("role") == "tool"]

    assert loaded["run_state"]["uncertain_operations"] == []
    assert recovered_tools[0]["content"] == "The user answered: React"


def test_tool_call_progress_is_live_safe_and_durable(service, tmp_path, monkeypatch):
    project = tmp_path / "tool-progress-project"
    project.mkdir()
    state = service.sessions.create(str(project), "model-a:latest", 4096)
    state["run_state"] = {"status": "running", "turn_id": "turn-progress", "safe_messages": [],
                          "partial_content": "", "partial_thinking": "", "active_operation": None}
    service.sessions.save(state)
    controller = {"session": state, "turn_id": "turn-progress", "checkpoint_lock": threading.RLock(),
                  "last_checkpoint": time.monotonic(), "last_journal_flush": time.monotonic(),
                  "journal_pending": []}
    emitted = []
    monkeypatch.setattr(service, "emit", emitted.append)
    journal_rows = []
    append_events = service.sessions.append_events
    def capture_events(session_id, workspace, events):
        journal_rows.extend(dict(row) for row in events)
        return append_events(session_id, workspace, events)
    monkeypatch.setattr(service.sessions, "append_events", capture_events)

    service._publish_run_event(controller, SimpleNamespace(workspace=project), {
        "type": "tool_call_progress", "provider": "ollama", "request_index": 0,
        "call_index": 0, "tool_name": "write_file", "argument_characters": 512,
        "argument_preview": '{"path":"src/app.ts",', "argument_preview_truncated": True,
    })
    service._publish_run_event(controller, SimpleNamespace(workspace=project), {
        "type": "tool_call_progress", "provider": "ollama", "request_index": 0,
        "call_index": 0, "tool_name": "write_file", "argument_characters": 1024,
        "argument_preview": '{"path":"src/app.ts","content":"partial', "argument_preview_truncated": True,
    })
    assert len(controller["journal_pending"]) == 1
    controller["last_journal_flush"] = 0
    service._publish_run_event(controller, SimpleNamespace(workspace=project), {
        "type": "tool_call_progress", "provider": "ollama", "request_index": 0,
        "call_index": 0, "tool_name": "write_file", "argument_characters": 1024,
        "argument_preview": '{"path":"src/app.ts","content":"partial', "argument_preview_truncated": True,
    })

    assert any(event.get("type") == "tool_call_progress" for event in emitted)
    assert any(event.get("type") == "activity_event" and event.get("activity", {}).get("kind") == "tool_preparation" for event in emitted)
    assert controller["journal_pending"] == []
    saved = service.sessions.load(state["session_id"], str(project))["state"]
    progress = next(event for event in saved.get("activity_events", []) if event.get("kind") == "tool_preparation")
    assert progress["name"] == "write_file"
    assert progress["argumentCharacters"] == 1024
    assert progress["argumentPreview"] == '{"path":"src/app.ts","content":"partial'
    assert progress["argumentPreviewTruncated"] is True
    assert sum(event.get("kind") == "tool_preparation" for event in saved.get("activity_events", [])) == 1
    assert "arguments" not in progress
    journal_progress = next(event for event in journal_rows if event.get("type") == "tool_call_progress")
    assert journal_progress["argument_preview"] == '{"path":"src/app.ts","content":"partial'
    assert journal_progress["argument_preview_truncated"] is True
    assert "arguments" not in journal_progress
    assert not any("arguments" in event for event in journal_rows)

    service._publish_run_event(controller, SimpleNamespace(workspace=project), {
        "type": "tool_batch", "request_index": 0, "assistantMessage": {"role": "assistant"}, "calls": [],
    })
    assembled = next(event for event in state["activity_events"] if event.get("kind") == "tool_preparation")
    assert assembled["status"] == "assembled"


def test_provider_telemetry_flushes_journal_without_rewriting_full_session_snapshots(service, tmp_path, monkeypatch):
    project = tmp_path / "journal-first-project"
    project.mkdir()
    state = service.sessions.create(str(project), "model-a:latest", 4096)
    state["run_state"] = {"status": "running", "turn_id": "turn-journal", "settings": {},
                          "partial_content": "", "partial_thinking": "", "active_operation": None}
    controller = {"session": state, "turn_id": "turn-journal", "checkpoint_lock": threading.RLock(),
                  "last_checkpoint": time.monotonic(), "last_journal_flush": time.monotonic(),
                  "journal_pending": []}
    snapshot_writes = []
    monkeypatch.setattr(service.sessions, "save", lambda snapshot: snapshot_writes.append(snapshot))
    monkeypatch.setattr(service, "emit", lambda _event: None)
    turn = SimpleNamespace(workspace=project)

    for event in (
        {"type": "prompt_manifest", "activityId": "turn-journal-request-1", "request_index": 1,
         "messages": [{"role": "system", "characters": 10, "estimated_tokens": 5}]},
        {"type": "inference_settings", "request_index": 1, "requested_context": 4096},
        {"type": "request_dispatched", "request_index": 1},
        {"type": "request_headers", "request_index": 1},
        {"type": "request_complete", "request_index": 1},
        {"type": "generation_usage", "request_index": 1, "usage": {"eval_count": 2}},
        {"type": "tool_batch", "request_index": 2, "assistantMessage": {"role": "assistant"},
         "calls": [{"id": "call-1", "name": "write_file"}]},
        {"type": "tool_start", "operationId": "op-1", "toolCallId": "call-1", "name": "write_file",
         "arguments": {"path": "src/app.py"}, "startedAt": time.time()},
        {"type": "tool_done", "operationId": "op-1", "toolCallId": "call-1", "name": "write_file",
         "result": "written", "status": "completed", "affectedFiles": ["src/app.py"], "completedAt": time.time()},
        {"type": "plan", "items": [{"title": "Implement changes", "status": "completed"}],
         "acceptanceCriteria": ["File updated"]},
    ):
        service._publish_run_event(controller, turn, event)

    assert snapshot_writes == []
    assert controller["journal_pending"] == []
    replayed = service.sessions.load(state["session_id"], str(project))["state"]
    prompt_rows = [row for row in replayed["activity_events"] if row.get("kind") == "prompt"]
    assert len(prompt_rows) == 1
    assert prompt_rows[0]["status"] == "response_stream_ended"
    assert prompt_rows[0]["providerUsage"] == {"eval_count": 2}
    assert replayed["plan"][0]["status"] == "completed"
    assert next(row for row in replayed["activity_events"] if row.get("operationId") == "op-1")["result"] == "written"


def test_tool_catalog_exposes_mcp_schema_capability_warning(service):
    service.mcp.servers = {"demo": {"command": "demo"}}
    service.mcp.clients["demo"] = (object(), object())
    service.mcp.schema_warnings = {"mcp__demo__schedule": ["$.properties.when.if: unsupported keyword"]}
    service.mcp_tools = [{"type": "function", "function": {"name": "mcp__demo__schedule",
                          "description": "create a schedule [validation does not support if]",
                          "parameters": {"type": "object"}}}]

    catalog = service.handle("tool_catalog", {})

    row = next(tool for tool in catalog["tools"] if tool["name"] == "mcp__demo__schedule")
    server = next(item for item in catalog["mcpServers"] if item["name"] == "demo")
    integration = next(item for item in catalog["integrations"] if item["name"] == "Local and remote MCP tools")
    assert "if" in row["description"]
    assert "does not support" in server["detail"]
    assert "1 discovered tool schema" in integration["detail"]


def test_next_task_rediscovers_mcp_server_after_a_transient_call_failure(service, tmp_path, monkeypatch):
    project = tmp_path / "mcp-reconnect-project"
    project.mkdir()
    service.mcp.servers = {"demo": {"command": "demo"}}
    service.mcp.discovered = True
    service.mcp.errors = {"demo": "ConnectionError: pipe failed"}
    service.mcp.retryable_servers = {"demo"}
    events = []
    monkeypatch.setattr(service, "emit", events.append)
    expected = [{"type": "function", "function": {"name": "mcp__demo__echo", "parameters": {"type": "object"}}}]
    discovery_count = []

    async def rediscover():
        discovery_count.append(True)
        service.mcp.errors.clear()
        service.mcp.retryable_servers.clear()
        return expected

    monkeypatch.setattr(service.mcp, "discover", rediscover)
    monkeypatch.setattr(service.mcp, "run", lambda awaitable, cancel_event=None: asyncio.run(awaitable))
    captured = {}

    class CapturingEngine:
        def __init__(self, *args, **kwargs):
            captured["mcp_tools"] = kwargs["mcp_tools"]
            self.event = args[5]
            self.runtime = object()

        def run(self, prompt, messages):
            self.event({"type": "complete", "workflowOutcome": "discussion"})
            return messages

        def cancel(self):
            pass

    monkeypatch.setattr(worker, "AgentEngine", CapturingEngine)
    service.handle("run_start", {"options": {
        "workspace": str(project), "prompt": "Check the project", "model": "model-a:latest",
        "context": 4096, "maxTokens": 512, "temperature": 0.2,
        "access": "edit", "approvalMode": "per-action",
    }})
    controller = service.active
    assert controller is not None
    controller["thread"].join(3)

    assert not controller["thread"].is_alive()
    assert discovery_count == [True]
    assert captured["mcp_tools"] == expected


def test_mcp_reconnect_failure_does_not_send_stale_tool_schemas_to_model(service, tmp_path, monkeypatch):
    project = tmp_path / "mcp-reconnect-failure-project"
    project.mkdir()
    stale = [{"type": "function", "function": {"name": "mcp__demo__echo", "parameters": {"type": "object"}}}]
    service.mcp.servers = {"demo": {"command": "demo"}}
    service.mcp.discovered = True
    service.mcp.errors = {"demo": "ConnectionError: pipe failed"}
    service.mcp.retryable_servers = {"demo"}
    service.mcp_tools = stale
    def fail_reconnect(awaitable, **_kwargs):
        awaitable.close()
        raise RuntimeError("cleanup failed")

    monkeypatch.setattr(service.mcp, "run", fail_reconnect)
    captured = {}

    class CapturingEngine:
        def __init__(self, *args, **kwargs):
            captured["mcp_tools"] = kwargs["mcp_tools"]
            self.event = args[5]
            self.runtime = object()

        def run(self, prompt, messages):
            self.event({"type": "complete", "workflowOutcome": "discussion"})
            return messages

        def cancel(self):
            pass

    monkeypatch.setattr(worker, "AgentEngine", CapturingEngine)
    service.handle("run_start", {"options": {
        "workspace": str(project), "prompt": "Check the project", "model": "model-a:latest",
        "context": 4096, "maxTokens": 512, "temperature": 0.2,
        "access": "edit", "approvalMode": "per-action",
    }})
    controller = service.active
    assert controller is not None
    controller["thread"].join(3)

    assert not controller["thread"].is_alive()
    assert captured["mcp_tools"] == []


def test_saved_operation_result_lookup_is_limited_to_captured_session_state():
    captured = {"activity_events": [
        {"operationId": "op-current", "result": "saved output"},
        {"operationId": "op-other", "result": "other output"},
    ]}
    assert worker._saved_operation_result(captured, "op-current") == "saved output"
    assert worker._saved_operation_result(captured, "op-missing") is None


def test_compaction_activity_records_in_task_exchange_omissions(service, tmp_path, monkeypatch):
    project = tmp_path / "compaction-project"
    project.mkdir()
    state = service.sessions.create(str(project), "model-a:latest", 4096)
    controller = {"session": state, "turn_id": "turn-compact", "checkpoint_lock": threading.RLock(),
                  "last_checkpoint": time.monotonic(), "last_journal_flush": time.monotonic() - 1,
                  "journal_pending": []}
    monkeypatch.setattr(service, "emit", lambda _event: None)

    service._publish_run_event(controller, SimpleNamespace(workspace=project), {
        "type": "context_compacted", "omittedTurns": 0, "retainedTurns": 1,
        "omittedOperationGroups": 7, "configuredContext": 4096, "inputBudget": 2560,
    })

    saved = service.sessions.load(state["session_id"], str(project))["state"]
    row = next(item for item in saved["activity_events"] if item["kind"] == "context")
    assert row["omittedOperationGroups"] == 7


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


def test_provider_retry_phase_is_journaled_and_snapshotted_immediately(service, tmp_path, monkeypatch):
    project = tmp_path / "provider-retry-checkpoint"
    project.mkdir()
    state = service.sessions.create(str(project), "model-a:latest", 8192)
    state["run_state"] = {"status": "running", "phase": "failed"}
    controller = {"session": state, "turn_id": "turn-retry", "checkpoint_lock": threading.RLock(),
                  "last_checkpoint": time.monotonic(), "last_journal_flush": time.monotonic(),
                  "journal_pending": []}
    snapshots = []
    journal_batches = []
    monkeypatch.setattr(service, "_save_active_session", lambda active: (
        snapshots.append(copy.deepcopy(active["session"])),
        {"app_saved": True, "project_saved": True, "error": None},
    )[-1])
    monkeypatch.setattr(service.sessions, "append_events", lambda _session, _workspace, rows: (
        journal_batches.append(copy.deepcopy(rows)),
        {"app_saved": True, "project_saved": True, "error": None},
    )[-1])
    monkeypatch.setattr(service, "emit", lambda _event: None)

    service._publish_run_event(controller, SimpleNamespace(workspace=project), {
        "type": "phase", "phase": "retrying provider · attempt 2 · next retry in 1s",
        "retryAttempt": 2, "retryDelaySeconds": 1, "httpStatus": 503,
        "failurePhase": "provider_http_error", "reason": "Service unavailable",
    })

    assert len(snapshots) == 1
    assert snapshots[0]["run_state"]["phase"].startswith("retrying provider")
    assert len(journal_batches) == 1
    assert journal_batches[0][0]["retryAttempt"] == 2


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


def test_cancel_before_worker_thread_starts_persists_terminal_run_state(service, tmp_path, monkeypatch):
    deferred = []
    events = []
    service.emit = events.append
    real_start = threading.Thread.start

    def defer_run_thread(thread):
        if thread.name == "agent-run":
            deferred.append(thread)
            return None
        return real_start(thread)

    monkeypatch.setattr(threading.Thread, "start", defer_run_thread)
    project = tmp_path / "pre-cancel-project"
    project.mkdir()
    service.handle("run_start", {"options": {
        "workspace": str(project), "prompt": "hello", "model": "model-a:latest",
        "context": 4096, "maxTokens": 128, "temperature": 0.2,
        "access": "ask", "approvalMode": "per-action",
    }})
    controller = service.active
    assert controller is not None and len(deferred) == 1
    session_id = controller["session"]["session_id"]

    service.cancel()
    real_start(deferred[0])
    deferred[0].join(3)

    saved = service.sessions.load(session_id)
    assert saved["run_state"]["status"] == "cancelled"
    assert saved["turns"][-1]["status"] == "cancelled"
    assert saved["turns"][-1]["transcript_saved"] is False
    assert any(event["type"] == "cancelled" for event in events)
    assert any(event["type"] == "run_idle" for event in events)


def test_keep_alive_is_not_passed_as_an_ollama_generation_option(service, tmp_path, monkeypatch):
    captured = {}
    engines = []

    class CapturingEngine:
        def __init__(self, root, model, context, access, approval, event, approve, **kwargs):
            self.event = event
            captured.update(kwargs)
            self.state = {}
            self.runtime = object()
            engines.append(self)

        def run(self, prompt, messages):
            messages.append({"role": "user", "content": prompt})
            self.event({"type": "complete", "workflowOutcome": "discussion", "verification": {"status": "not_verified"}})
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


def test_successful_completion_outcome_is_delivered_after_session_save(service, tmp_path, monkeypatch):
    events = []
    service.emit = events.append

    class CompletingEngine:
        def __init__(self, root, model, context, access, approval, event, approve, **kwargs):
            self.event = event
            self.state = {}
            self.runtime = object()

        def run(self, prompt, messages):
            messages.append({"role": "assistant", "content": "The change is ready."})
            self.event({"type": "complete", "workflowOutcome": "changed", "projectChanged": True,
                        "verification": {"status": "not_verified", "steps": []}})
            return messages

        def cancel(self):
            pass

    monkeypatch.setattr(worker, "AgentEngine", CompletingEngine)
    project = tmp_path / "completion-project"
    project.mkdir()
    service.handle("run_start", {"options": {
        "workspace": str(project), "prompt": "make a small change", "model": "model-a:latest",
        "context": 4096, "maxTokens": 128, "temperature": 0.2,
        "access": "ask", "approvalMode": "per-action",
    }})
    controller = service.active
    assert controller is not None
    session_id = controller["session"]["session_id"]
    controller["thread"].join(3)

    saved = service.sessions.load(session_id)
    assert saved["run_state"]["workflow_outcome"] == "changed"
    saved_index = next(i for i, event in enumerate(events) if event["type"] == "session_saved")
    complete_index = next(i for i, event in enumerate(events) if event["type"] == "complete")
    assert saved_index < complete_index
    assert events[complete_index]["workflowOutcome"] == "changed"


def test_engine_return_without_completion_event_fails_closed(service, tmp_path, monkeypatch):
    events = []
    service.emit = events.append

    class IncompleteEngine:
        def __init__(self, root, model, context, access, approval, event, approve, **kwargs):
            self.state = {}
            self.runtime = object()

        def run(self, prompt, messages):
            return [*messages, {"role": "assistant", "content": "Maybe complete?"}]

        def cancel(self):
            pass

    monkeypatch.setattr(worker, "AgentEngine", IncompleteEngine)
    project = tmp_path / "missing-completion-project"
    project.mkdir()
    service.handle("run_start", {"options": {
        "workspace": str(project), "prompt": "do work", "model": "model-a:latest",
        "context": 4096, "maxTokens": 128, "temperature": 0.2,
        "access": "ask", "approvalMode": "per-action",
    }})
    controller = service.active
    assert controller is not None
    session_id = controller["session"]["session_id"]
    controller["thread"].join(3)

    saved = service.sessions.load(session_id)
    assert saved["run_state"]["status"] == "failed"
    assert saved["run_state"]["workflow_outcome"] == "failed"
    assert saved["task_checkpoint"]["current"]["status"] == "failed"
    assert any(event.get("type") == "error" and "terminal completion event" in event.get("error", "") for event in events)


def test_engine_failure_is_saved_with_the_session(service, tmp_path, monkeypatch):
    events = []
    service.emit = events.append

    class FailingEngine:
        def __init__(self, root, model, context, access, approval, event, approve, **kwargs):
            self.state = {}
            self.runtime = object()
            self.event = event

        def run(self, prompt, messages):
            messages.append({"role": "user", "content": prompt})
            self.event({"type": "error", "error": "Synthetic provider stream failure",
                        "workflowOutcome": "response_missing"})
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
    assert "Synthetic provider stream failure" in saved["last_error"]["diagnostic"]
    assert saved["run_state"]["status"] == "failed"
    assert saved["run_state"]["workflow_outcome"] == "response_missing"
    assert sum(event.get("type") == "error" and event.get("error") == "Synthetic provider stream failure"
               for event in events) == 1


def test_engine_failure_does_not_claim_session_saved_when_both_mirrors_fail(service, tmp_path, monkeypatch):
    events = []
    service.emit = events.append

    class FailingSaveEngine:
        def __init__(self, root, model, context, access, approval, event, approve, **kwargs):
            self.event = event
            self.runtime = object()
            self.state = {}

        def run(self, prompt, messages):
            service.sessions.save = lambda _state: {
                "app_saved": False, "project_saved": False, "error": "simulated mirror failure",
            }
            raise RuntimeError("synthetic run failure")

        def cancel(self):
            pass

    monkeypatch.setattr(worker, "AgentEngine", FailingSaveEngine)
    project = tmp_path / "failed-save-project"
    project.mkdir()
    service.handle("run_start", {"options": {
        "workspace": str(project), "prompt": "hello", "model": "model-a:latest",
        "context": 4096, "maxTokens": 128, "temperature": 0.2,
        "access": "ask", "approvalMode": "per-action",
    }})
    controller = service.active
    assert controller is not None
    controller["thread"].join(3)

    assert not any(event.get("type") == "session_saved" for event in events)
    assert any(event.get("type") == "session_mirror_error" and "simulated mirror failure" in event.get("error", "")
               for event in events)
    assert sum(event.get("type") == "error" and event.get("error") == "RuntimeError: synthetic run failure"
               for event in events) == 1


def test_incomplete_provider_stream_preserves_partial_reasoning_and_request_failure(service, tmp_path, monkeypatch):
    class IncompleteStreamEngine:
        def __init__(self, root, model, context, access, approval, event, approve, **kwargs):
            self.state = {}
            self.runtime = object()
            self.event = event

        def run(self, prompt, messages):
            messages.append({"role": "user", "content": prompt})
            self.event({"type": "prompt_manifest", "request_index": 1, "messages": []})
            self.event({"type": "request_dispatched", "provider": "ollama", "request_index": 1})
            self.event({"type": "request_headers", "provider": "ollama", "request_index": 1,
                        "http_status": 200, "header_wait_seconds": 0.5})
            self.event({"type": "phase", "phase": "waiting"})
            self.event({"type": "phase", "phase": "reasoning", "elapsed": 3.0})
            self.event({"type": "thinking", "text": "partial reasoning before disconnect"})
            self.event({"type": "request_error", "provider": "ollama", "request_index": 1,
                        "phase": "streaming_response", "cancelled": False,
                        "error": "Ollama stream closed without its final done=true record."})
            self.event({"type": "error", "error": "Ollama stream closed without its final done=true record.",
                        "partial_response_saved": True})
            return messages

        def cancel(self):
            pass

    monkeypatch.setattr(worker, "AgentEngine", IncompleteStreamEngine)
    project = tmp_path / "incomplete-stream-project"
    project.mkdir()
    service.handle("run_start", {"options": {
        "workspace": str(project), "prompt": "inspect this project", "model": "model-a:latest",
        "context": 4096, "maxTokens": 128, "temperature": 0.2,
        "access": "ask", "approvalMode": "per-action",
    }})
    controller = service.active
    assert controller is not None
    session_id = controller["session"]["session_id"]
    controller["thread"].join(3)

    saved = service.sessions.load(session_id)
    assert saved["run_state"]["status"] == "failed"
    assert saved["run_state"]["partial_response_saved"] is True
    assert saved["last_error"]["message"].endswith("done=true record.")
    assert any(row.get("role") == "assistant" and row.get("thinking") == "partial reasoning before disconnect"
               for row in saved["messages"])
    prompt = next(row for row in saved["activity_events"] if row.get("kind") == "prompt")
    assert prompt["providerRequest"]["dispatch_status"] == "request_failed"
    assert prompt["providerRequest"]["failure_phase"] == "streaming_response"


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
    identity = {"session_id": "session-1", "turn_id": "turn-1", "workspace": "C:/project"}
    service.active = {"pending": {"action-1": (condition, result)}, "pending_approval_identity": {"action-1": identity}}
    assert service.approval_reply("missing", True, "session-1", "turn-1", "C:/project") is False
    assert service.approval_reply("action-1", True, "wrong-session", "turn-1", "C:/project") is False
    assert service.approval_reply("action-1", True, "session-1", "wrong-turn", "C:/project") is False
    assert service.approval_reply("action-1", True, "session-1", "turn-1", "C:/other") is False
    assert result == {"done": False, "approved": False}
    assert service.approval_reply("action-1", True, "session-1", "turn-1", "C:/project") is True
    assert service.approval_reply("action-1", False, "session-1", "turn-1", "C:/project") is False
    assert result == {"done": True, "approved": True}


def test_per_session_approval_is_mirrored_before_approval_is_accepted(service, tmp_path, monkeypatch):
    project = tmp_path / "session-approval-project"
    project.mkdir()
    state = service.sessions.create(str(project), "model-a:latest", 4096)
    condition = threading.Condition()
    result = {"done": False, "approved": False}
    controller = {"session": state, "approval_mode": "per-session", "checkpoint_lock": threading.RLock(),
                  "pending": {"action-1": (condition, result)},
                  "pending_approval_identity": {"action-1": {"session_id": state["session_id"], "turn_id": "turn-1", "workspace": str(project)}}}
    service.active = controller
    events = []
    monkeypatch.setattr(service, "emit", events.append)

    assert service.approval_reply("action-1", True, state["session_id"], "turn-1", str(project)) is True
    stored = service.sessions.load(state["session_id"], str(project))["state"]
    assert stored["session_approval_granted"] is True
    assert result == {"done": True, "approved": True}


def test_per_session_approval_save_does_not_hold_checkpoint_lock(service, tmp_path, monkeypatch):
    project = tmp_path / "slow-session-approval-project"
    project.mkdir()
    state = service.sessions.create(str(project), "model-a:latest", 4096)
    checkpoint_lock = threading.RLock()
    condition = threading.Condition()
    result = {"done": False, "approved": False}
    controller = {"session": state, "approval_mode": "per-session", "checkpoint_lock": checkpoint_lock,
                  "pending": {"action-1": (condition, result)},
                  "pending_approval_identity": {"action-1": {"session_id": state["session_id"], "turn_id": "turn-1", "workspace": str(project)}}}
    service.active = controller
    save_started = threading.Event()
    release_save = threading.Event()
    lock_acquired = threading.Event()
    monkeypatch.setattr(service.sessions, "save", lambda _state: (
        save_started.set(), release_save.wait(2), {"app_saved": True, "project_saved": True, "error": None}
    )[-1])
    approved = []
    approval_thread = threading.Thread(target=lambda: approved.append(service.approval_reply("action-1", True, state["session_id"], "turn-1", str(project))))
    approval_thread.start()
    assert save_started.wait(2)

    def acquire_checkpoint():
        with checkpoint_lock:
            lock_acquired.set()

    checkpoint_thread = threading.Thread(target=acquire_checkpoint)
    checkpoint_thread.start()
    assert lock_acquired.wait(1), "a slow mirror save must not block active checkpoint access"
    release_save.set()
    approval_thread.join(2)
    checkpoint_thread.join(2)

    assert approved == [True]
    assert result == {"done": True, "approved": True}


def test_per_session_approval_fails_closed_when_mirror_save_fails(service, tmp_path, monkeypatch):
    project = tmp_path / "session-approval-save-failure"
    project.mkdir()
    state = service.sessions.create(str(project), "model-a:latest", 4096)
    condition = threading.Condition()
    result = {"done": False, "approved": False}
    controller = {"session": state, "approval_mode": "per-session", "checkpoint_lock": threading.RLock(),
                  "pending": {"action-1": (condition, result)},
                  "pending_approval_identity": {"action-1": {"session_id": state["session_id"], "turn_id": "turn-1", "workspace": str(project)}}}
    service.active = controller
    monkeypatch.setattr(service.sessions, "save", lambda _state: {"app_saved": True, "project_saved": False, "error": "fixture lock"})
    events = []
    monkeypatch.setattr(service, "emit", events.append)

    assert service.approval_reply("action-1", True, state["session_id"], "turn-1", str(project)) is False
    assert state["session_approval_granted"] is False
    assert result == {"done": False, "approved": False}
    assert events[-1]["type"] == "session_mirror_error"


def test_ask_user_pauses_for_answer_and_resumes_with_saved_tool_result(service, tmp_path, monkeypatch):
    from types import SimpleNamespace

    project = tmp_path / "question-project"
    project.mkdir()
    events = []
    controller = {"cancel": threading.Event(), "pending_questions": {}, "session": {"session_id": "session-question"}, "turn_id": "turn-question"}
    service.active = controller
    monkeypatch.setattr(service, "_publish_run_event", lambda _controller, _turn, event: events.append(event))
    result = []
    thread = threading.Thread(target=lambda: result.append(service._ask_user(
        controller, SimpleNamespace(workspace=project),
        {"title": "Choose a framework", "question": "Which framework should I use?",
         "options": [{"label": "React"}, {"label": "Vue"}]},
    )))
    thread.start()
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline and not events:
        time.sleep(0.01)
    assert events[0]["type"] == "question_request"
    question_id = events[0]["questionId"]
    assert service.handle("question_reply", {"questionId": question_id, "sessionId": "wrong-session",
                                               "turnId": "turn-question", "answer": "React"}) == {"answered": False, "stale": True}
    assert service.handle("question_reply", {"questionId": question_id, "sessionId": "session-question",
                                               "turnId": "old-turn", "answer": "React"}) == {"answered": False, "stale": True}
    assert service.handle("question_reply", {"questionId": question_id, "sessionId": "session-question",
                                               "turnId": "turn-question", "answer": "React"}) == {"answered": True, "stale": False}
    assert service.handle("question_reply", {"questionId": question_id, "sessionId": "session-question",
                                               "turnId": "turn-question", "answer": "Vue"}) == {"answered": False, "stale": True}
    thread.join(2)

    assert not thread.is_alive()
    assert result == ["React"]
    assert events[1]["type"] == "question_answered"
    assert events[1]["status"] == "answered"


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
            self.event({"type": "complete", "workflowOutcome": "changed", "projectChanged": True,
                        "verification": {"status": "not_verified", "steps": []}})
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
    assert service.approval_reply(request["actionId"], True, request["sessionId"], request["turnId"], request["workspace"]) is True
    controller["thread"].join(3)

    saved = service.sessions.load(controller["session"]["session_id"])
    operations = [item for item in saved["activity_events"] if item.get("operationId") == "op-1"]
    assert len(operations) == 1
    assert operations[0]["kind"] == "operation"
    assert operations[0]["approvalStatus"] == "approved"
    assert operations[0]["status"] == "completed"


def test_uncertain_mcp_retry_requires_one_action_review_even_with_session_approval(service, tmp_path, monkeypatch):
    events = []
    service.emit = events.append

    class ApprovalEngine:
        def __init__(self, root, model, context, access, approval, event, approve, **kwargs):
            self.event = event
            self.approve = approve
            self.state = {}
            self.runtime = object()
            self.checkpoint = kwargs["task_checkpoint"]

        def run(self, prompt, messages):
            self.checkpoint["current"]["uncertain_operation"] = {
                "operationId": "uncertain-1", "name": "mcp__calendar__create_event",
                "status": "uncertain", "result": "response timed out",
            }
            self.event({"type": "tool_start", "operationId": "retry-1", "toolCallId": "retry-call",
                        "name": "mcp__calendar__create_event", "arguments": {"title": "Review"}, "startedAt": 1})
            assert self.approve("mcp__calendar__create_event", {"title": "Review"}) is True
            self.event({"type": "tool_done", "operationId": "retry-1", "toolCallId": "retry-call",
                        "name": "mcp__calendar__create_event", "status": "completed",
                        "result": "created event-42", "affectedFiles": [], "completedAt": 2})
            self.event({"type": "complete", "workflowOutcome": "blocked", "projectChanged": False,
                        "verification": {"status": "blocked", "steps": []}})
            return messages

        def cancel(self):
            pass

    monkeypatch.setattr(worker, "AgentEngine", ApprovalEngine)
    project = tmp_path / "uncertain-mcp-approval"
    project.mkdir()
    service.handle("run_start", {"options": {
        "workspace": str(project), "prompt": "check the uncertain event", "model": "model-a:latest",
        "context": 4096, "maxTokens": 128, "temperature": 0.2,
        "access": "ask", "approvalMode": "per-session",
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
    assert request["mode"] == "per-action"
    assert request["reason"] == "uncertain_mcp_retry"
    assert request["uncertainOperationId"] == "uncertain-1"
    assert service.approval_reply(request["actionId"], True, request["sessionId"], request["turnId"], request["workspace"]) is True
    controller["thread"].join(3)

    saved = service.sessions.load(controller["session"]["session_id"])
    activity = next(item for item in saved["activity_events"] if item.get("operationId") == "retry-1")
    assert activity["approvalMode"] == "per-action"
    assert activity["approvalReason"] == "uncertain_mcp_retry"
    assert activity["approvalStatus"] == "approved"


def test_run_cancel_reports_whether_a_run_was_active(service):
    assert service.handle("run_cancel", {"sessionId": "none", "turnId": "none"}) == {"cancelled": False, "stale": True}
    controller = {"cancel": threading.Event(), "engine": None, "pending": {},
                  "session": {"session_id": "session-cancel"}, "turn_id": "turn-cancel"}
    service.active = controller
    assert service.handle("run_cancel", {"sessionId": "session-cancel", "turnId": "old-turn"}) == {"cancelled": False, "stale": True}
    assert not controller["cancel"].is_set()
    assert service.handle("run_cancel", {"sessionId": "session-cancel", "turnId": "turn-cancel"}) == {"cancelled": True, "stale": False}
    assert controller["cancel"].is_set()
