import json
import threading
from unittest.mock import patch

import pytest
from sidecar.worker import AgentEngine, OllamaRuntime, RequestScopedOllama
import desktop_engine


class FakeResponse:
    def __init__(self, rows):
        self.rows = iter(rows)
        self.closed = False
        self.status = 200
        self.reason = "OK"
        self.headers = {}

    def readline(self):
        return next(self.rows, b"")

    def close(self):
        self.closed = True


def test_ollama_jsonl_stream_preserves_requested_context_and_model_reasoning_default():
    response = FakeResponse([
        b'{"message":{"content":"hello"}}\n',
        b'{"message":{"tool_calls":[{"function":{"name":"list_files","arguments":"{\\"path\\":\\".\\"}"}}]},"done":true}\n',
    ])
    runtime = OllamaRuntime()
    state = {
        "model": "mock:latest", "registry": type("Registry", (), {"schemas": []})(),
        "temperature": 0.2, "context": 262144, "max_tokens": 1024, "keep_alive": "30m",
    }
    events = []
    def open_stream(request, _cancel, register, on_dispatched=None, on_headers=None):
        if on_dispatched:
            on_dispatched()
        register(None, response)
        if on_headers:
            on_headers(response)
        return response

    with patch.object(desktop_engine, "open_http_stream", side_effect=open_stream) as open_url:
        result = runtime.stream(state, [], threading.Event(), events.append)

    payload = json.loads(open_url.call_args.args[0].data)
    assert payload["options"]["num_ctx"] == 262144
    assert payload["options"]["num_predict"] == 1024
    assert payload["keep_alive"] == "30m"
    assert "think" not in payload and "reasoning_effort" not in payload
    assert result["message"]["content"] == "hello"
    assert result["message"]["tool_calls"][0]["function"]["name"] == "list_files"
    assert any(event.get("phase") == "generating" for event in events)
    assert response.closed


def test_ollama_preload_sends_only_model_context_and_keep_alive():
    class JsonResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def read(self):
            return b'{"done":true}'

    runtime = OllamaRuntime()
    with patch("urllib.request.urlopen", return_value=JsonResponse()) as open_url:
        runtime.preload("mock:latest", 65536, "30m")

    request = open_url.call_args.args[0]
    payload = json.loads(request.data)
    assert request.full_url == "http://127.0.0.1:11434/api/generate"
    assert payload == {
        "model": "mock:latest", "prompt": "", "stream": False,
        "keep_alive": "30m", "options": {"num_ctx": 65536},
    }
    assert "think" not in payload
    assert open_url.call_args.kwargs["timeout"] is None


def test_cancel_closes_only_the_active_stream_and_does_not_send_stop_request():
    response = FakeResponse([b'{"message":{"content":"first"}}\n', b""])
    runtime = OllamaRuntime()
    cancel = threading.Event()
    state = {
        "model": "mock:latest", "registry": type("Registry", (), {"schemas": []})(),
        "temperature": 0.2, "context": 4096, "max_tokens": 64,
    }
    read = response.readline

    def read_then_cancel():
        row = read()
        if row:
            cancel.set()
        return row

    response.readline = read_then_cancel
    def open_stream(_request, _cancel, register, on_dispatched=None, on_headers=None):
        if on_dispatched:
            on_dispatched()
        register(None, response)
        if on_headers:
            on_headers(response)
        return response

    with patch.object(desktop_engine, "open_http_stream", side_effect=open_stream), patch.object(runtime, "get") as api_call:
        with pytest.raises(Exception, match="Cancelled"):
            runtime.stream(state, [], cancel, lambda _event: None)
    assert response.closed
    api_call.assert_not_called()


def test_stream_close_exception_is_reported_as_request_cancellation():
    started = threading.Event()
    cancel = threading.Event()

    class BlockingRuntime:
        def stream(self, _state, _messages, _cancel, _emit):
            started.set()
            while not cancel.is_set():
                cancel.wait(0.01)
            error = ValueError("response closed")
            error.partial_message = {"role": "assistant", "content": "partial reply"}
            raise error

        def cancel(self):
            cancel.set()

    adapter = RequestScopedOllama(BlockingRuntime())
    state = {"model": "mock:latest"}
    errors = []

    def run():
        try:
            adapter.stream(state, [], cancel, lambda _event: None)
        except Exception as exc:
            errors.append(exc)

    thread = threading.Thread(target=run)
    thread.start()
    assert started.wait(1)
    adapter.cancel()
    thread.join(1)
    assert len(errors) == 1 and type(errors[0]).__name__ == "RequestCancelled"
    assert errors[0].partial_message == {"role": "assistant", "content": "partial reply"}


def test_stream_reports_exact_usage_for_every_ollama_response():
    class UsageRuntime:
        def stream(self, _state, _messages, _cancel, _emit):
            return {"prompt_eval_count": 100, "prompt_eval_cached_count": 60, "prompt_eval_duration": 800_000_000,
                    "eval_count": 9, "eval_duration": 4_500_000_000, "load_duration": 30_000_000, "message": {"content": "done"}}

        def cancel(self):
            pass

    events = []
    adapter = RequestScopedOllama(UsageRuntime())

    result = adapter.stream({"request_index": 7}, [], threading.Event(), events.append)

    assert result["eval_count"] == 9
    assert events == [{"type": "generation_usage", "request_index": 7, "usage": {
        "prompt_eval_count": 100, "prompt_eval_cached_count": 60, "prompt_eval_duration": 800_000_000,
        "eval_count": 9, "eval_duration": 4_500_000_000, "load_duration": 30_000_000,
    }}]


def test_context_retrieval_and_compaction_keep_recent_task_and_configured_window(tmp_path):
    (tmp_path / "alpha.py").write_text("def target_function():\n    return 42\n", encoding="utf-8")
    (tmp_path / "unrelated.md").write_text("notes about a different subject", encoding="utf-8")
    from desktop_engine import ContextManager

    context = ContextManager(16384, reserve=1024)
    retrieved = context.retrieve(tmp_path, "explain target_function")
    assert "alpha.py" in retrieved
    assert "unrelated.md" not in retrieved
    history = [
        {"role": "system", "content": "instructions"},
        {"role": "user", "content": "old " * 4000},
        {"role": "assistant", "content": "old answer " * 2000},
        {"role": "user", "content": "current request"},
    ]
    compacted = context.compact(history, output_tokens=512)
    assert compacted[0] == history[0]
    assert "current request" in compacted[-1]["content"]
    assert len(json.dumps(compacted)) < len(json.dumps(history))
    assert context.context == 16384
