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
        os.replace(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _normalize_path(value: str | Path) -> str:
    return os.path.normcase(str(Path(value).resolve()))


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
        state.update(workspace_id=metadata["workspace_id"], activity_events=[], plan=[], run_state=None)
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
            app_path = self.app.root / (SessionStore._safe(state["session_id"]) + ".json")
            _atomic_json(app_path, state)
            result = {"app_saved": True, "project_saved": False, "git_ignored": None, "error": setup_error}
            if root is None or metadata is None:
                return result
            try:
                store = self._project_store(root, create=True)
                _atomic_json(store.root / (SessionStore._safe(state["session_id"]) + ".json"), state)
                result["project_saved"] = True
                result["git_ignored"] = not bool(metadata.get("track_sessions", False))
            except (OSError, ValueError, KeyError) as exc:
                result["error"] = f"{type(exc).__name__}: {exc}"
            return result

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
        if len(versions) == 2:
            same = self._fingerprint(versions[0]["state"]) == self._fingerprint(versions[1]["state"])
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
            return state
        if workspace:
            root = Path(workspace).resolve(strict=True)
            metadata = self.identity.read(root, create=True) or {}
            if state.get("workspace_id") and state["workspace_id"] != metadata.get("workspace_id"):
                raise ValueError("This session belongs to a different project identity.")
            state["workspace"] = str(root)
            state["workspace_id"] = metadata["workspace_id"]
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
            rows.append({key: state.get(key) for key in ("session_id", "workspace", "workspace_id", "model", "provider_id", "model_id", "updated_at")}
                        | {"sync_conflict": conflict, "recommended_source": "project" if conflict else ("project" if any(row["source"] == "project" for row in versions) else "app"), "sources": [row["source"] for row in versions]})
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
