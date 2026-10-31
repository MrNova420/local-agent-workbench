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

from desktop_engine import AgentEngine, OllamaRuntime, RequestCancelled  # noqa: E402
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
from sessions import SessionStore  # noqa: E402
from telemetry import Telemetry  # noqa: E402
from turn_context import TurnContext, validate_selected_workspace  # noqa: E402
from ui_events import AgentEventRelay  # noqa: E402
from hf_catalog import HuggingFaceCatalog  # noqa: E402
from llama_cpp_runtime import LlamaCppServer  # noqa: E402
from providers.llama_cpp import LlamaCppProvider  # noqa: E402
from providers.ollama import OllamaProvider  # noqa: E402
from providers.registry import ProviderRegistry  # noqa: E402


APP_DATA = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local")) / "LocalAgentWorkbench"


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
                for key in ("eval_count", "eval_duration")
                if isinstance(result.get(key), (int, float)) and not isinstance(result.get(key), bool)
            }
            if usage:
                emit({"type": "generation_usage", "usage": usage})
            return result
        except Exception as exc:
            if cancel.is_set():
                raise RequestCancelled("Cancelled") from exc
            raise


class AgentService:
    """New app's stdio service adapter around the shared local agent engine."""

    def __init__(self) -> None:
        self.sessions = SessionStore(APP_DATA / "sessions")
        self.runtime = OllamaRuntime()
        self.telemetry = Telemetry()
        self.mcp = MCPManager(APP_DATA / "mcp.json")
        self.mcp.load()
        self.hf = HuggingFaceCatalog(APP_DATA / "models" / "huggingface")
        self.llama = LlamaCppServer(APP_DATA)
        self.model_sources_path = APP_DATA / "model-sources.json"
        self.llama_config_path = APP_DATA / "llama.json"
        self.gguf_models = self._load_json(self.model_sources_path, [])
        self.llama_config = self._load_json(self.llama_config_path, {})
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
        self.active_lock = threading.RLock()
        self.active: dict[str, Any] | None = None
        self.output_ids: queue.SimpleQueue[str] = queue.SimpleQueue()

    def emit(self, event: dict[str, Any]) -> None:
        with self.emit_lock:
            sys.stdout.write(json.dumps({"type": "event", "event": event}, ensure_ascii=False) + "\n")
            sys.stdout.flush()

    def respond(self, request_id: str, ok: bool, data: Any = None, error: str | None = None) -> None:
        with self.emit_lock:
            payload = {"type": "response", "id": request_id, "ok": ok}
            if ok:
                payload["data"] = data
            else:
                payload["error"] = error or "Request failed."
            sys.stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
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
            gguf_models = [{"id": row.model_id, "label": row.display_name, "provider": row.provider_id}
                           for row in self.providers.by_id("llama.cpp").models()]
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
                        "reasoning": {"support": "levels", "default": "auto",
                                      "values": [False, True, "minimal", "low", "medium", "high", "xhigh", "max"]}}
            info = self.runtime.model_info(str(message["model"]))
            details = info.get("model_info", {})
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
            support = "levels" if any(isinstance(value, str) for value in values) else "toggle" if True in values and False in values else "none" if values == [False] else "unknown"
            return {
                "model": message["model"], "context": context, "max_output_tokens": None,
                "reasoning": {"support": support, "default": default, "values": values},
                "provider": "ollama", "context_limit_known": context is not None,
            }
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
            result["llama"] = self.llama.status()
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
        if command == "workspace_diff":
            root = validate_selected_workspace(True, message["workspace"])
            import subprocess

            result = subprocess.run(
                ["git", "diff", "--no-ext-diff", "--"], cwd=root,
                capture_output=True, text=True, timeout=15, check=False, shell=False,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            return {"text": (result.stdout + result.stderr).strip() or "No unstaged Git changes."}
        if command == "sessions_list":
            workspace = message.get("workspace")
            rows = self.sessions.list()
            if workspace:
                target = str(Path(workspace).resolve())
                rows = [row for row in rows if row.get("workspace") and str(Path(row["workspace"]).resolve()) == target]
            return rows
        if command == "session_new":
            root = validate_selected_workspace(True, message["workspace"])
            model = str(message.get("model", "")).strip()
            context = int(message.get("context", 0))
            if not model or context < 1024:
                raise ValueError("Choose an installed model and an explicit context of at least 1,024 tokens.")
            state = self.sessions.create(str(root), model, context)
            self.sessions.save(state)
            return state
        if command == "session_resume":
            state = self.sessions.load(str(message["sessionId"]))
            source = validate_selected_workspace(True, state["workspace"])
            if state.get("access") == "copy":
                expected = managed_copy_path(APP_DATA / "workspaces", state["session_id"], require_exists=True)
                saved = Path(state.get("working_workspace", "")).resolve(strict=True)
                if saved != expected or not isinstance(state.get("copy_manifest"), dict):
                    raise ValueError("Saved disposable workspace is missing or invalid; refusing to resume it.")
                state["working_workspace"] = str(saved)
            state["workspace"] = str(source)
            return state
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
            if not self.run_lock.acquire(blocking=False):
                raise RuntimeError("A task is already running.")
            try:
                self._start_run(options)
            except Exception:
                self.run_lock.release()
                raise
            return {"started": True}
        if command == "run_cancel":
            self.cancel()
            return {"cancelled": True}
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
        turn = TurnContext.capture(
            workspace=working, model=model, context=state["context"], access=access,
            approval_mode=approval_mode, max_tokens=state["max_tokens"],
            temperature=state["temperature"], runtime_options=state.get("runtime_options", {}),
            prompt=prompt, session=state, mcp_tools=list(self.mcp_tools),
        )
        controller = {"cancel": threading.Event(), "engine": None, "pending": {}, "session": turn.session, "source": source, "working": working}
        with self.active_lock:
            self.active = controller
        self.sessions.save(controller["session"])
        thread = threading.Thread(target=self._run_turn, args=(controller, turn), name="agent-run", daemon=True)
        controller["thread"] = thread
        thread.start()

    def _run_turn(self, controller: dict[str, Any], turn: TurnContext) -> None:
        state = controller["session"]
        relay = AgentEventRelay(lambda event: self.emit({**event, "sessionId": state["session_id"], "workspace": str(turn.workspace)}))
        try:
            if controller["cancel"].is_set():
                self.emit({"type": "cancelled", "elapsed": 0, "sessionId": state["session_id"]})
                return
            mcp_tools = list(turn.mcp_tools)
            if self.mcp.servers and not self.mcp.discovered:
                mcp_tools = self.mcp.run(self.mcp.discover(), cancel_event=controller["cancel"])
                self.mcp_tools = mcp_tools
                failed = ", ".join(self.mcp.errors.values())
                self.emit({"type": "mcp_status", "text": f"{len(mcp_tools)} local tools ready" + (f" · {failed}" if failed else "")})

            knowledge = ProjectKnowledge(turn.workspace)

            def approve(name: str, args: Any) -> bool:
                action_id = uuid.uuid4().hex
                condition = threading.Condition()
                result = {"done": False, "approved": False}
                with self.active_lock:
                    controller["pending"][action_id] = (condition, result)
                self.emit({"type": "approval_request", "actionId": action_id, "name": name,
                           "arguments": args, "workspace": str(turn.workspace),
                           "mode": turn.approval_mode, "sessionId": state["session_id"]})
                with condition:
                    while not result["done"] and not controller["cancel"].is_set():
                        condition.wait(0.25)
                with self.active_lock:
                    controller["pending"].pop(action_id, None)
                return bool(result["approved"])

            engine = AgentEngine(
                turn.workspace, turn.model, turn.context, turn.access, turn.approval_mode,
                relay, approve, runtime_options={**turn.runtime_options, "keep_alive": state.get("keep_alive", "30m")},
                max_tokens=turn.max_tokens, temperature=turn.temperature,
                project_instructions=knowledge.instructions(), mcp_tools=mcp_tools,
                mcp_call=lambda name, args: self.mcp.run(self.mcp.call(name, args), cancel_event=controller["cancel"]),
            )
            chosen_runtime = self.providers.runtime_for(turn.model, engine.runtime, state.get("provider_id"))
            engine.runtime = RequestScopedOllama(chosen_runtime)
            engine.state["reasoning"] = state.get("reasoning")
            engine.state["keep_alive"] = state.get("keep_alive", "30m")
            controller["engine"] = engine
            if controller["cancel"].is_set():
                engine.cancel()
            messages = engine.run(turn.prompt, state.get("messages", []))
            state["messages"] = messages
            state.setdefault("turns", []).append({"prompt": turn.prompt, "started_at": time.time(), "workspace": str(turn.workspace), "approval_mode": turn.approval_mode})
            state["working_workspace"] = str(turn.workspace)
            if turn.access == "copy":
                state["copy_manifest"] = state.get("copy_manifest") or capture_manifest(turn.workspace)
            self.sessions.save(state)
            self.emit({"type": "session_saved", "sessionId": state["session_id"], "workspace": state["workspace"]})
            relay.emit_terminal_after_persist()
        except Exception as exc:
            state["messages"] = state.get("messages", [])
            try:
                self.sessions.save(state)
                self.emit({"type": "session_saved", "sessionId": state["session_id"], "workspace": state["workspace"]})
            except Exception as save_error:
                self.emit({"type": "error", "error": f"{exc}; session save failed: {save_error}"})
            self.emit({"type": "error", "error": f"{type(exc).__name__}: {exc}", "sessionId": state["session_id"]})
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

    def cancel(self) -> None:
        with self.active_lock:
            controller = self.active
        if not controller:
            return
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


def main() -> None:
    service = AgentService()
    sys.stdout.write(json.dumps({"type": "ready", "version": "0.1.0"}) + "\n")
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
