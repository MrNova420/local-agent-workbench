import json
import tempfile
import unittest
from pathlib import Path

from sidecar.persistence import MirroredSessionStore, WorkspaceHistory


class MirroredSessionStoreTests(unittest.TestCase):
    def test_session_is_saved_to_app_library_and_project_mirror(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "project"
            root.mkdir()
            store = MirroredSessionStore(Path(temp) / "app")

            state = store.create(str(root), "model", 8192)
            state["activity_events"] = [{"type": "tool_done", "result": "complete"}]
            store.save(state)

            app_copy = Path(temp) / "app" / "sessions" / f"{state['session_id']}.json"
            project_copy = root / ".agent-workbench" / "sessions" / f"{state['session_id']}.json"
            self.assertEqual(json.loads(app_copy.read_text(encoding="utf-8")), json.loads(project_copy.read_text(encoding="utf-8")))
            self.assertTrue((root / ".agent-workbench" / "workspace.json").is_file())

    def test_divergent_versions_require_a_choice_and_keep_both_until_resolved(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "project"
            root.mkdir()
            store = MirroredSessionStore(Path(temp) / "app")
            state = store.create(str(root), "model", 8192)
            state["messages"].append({"role": "user", "content": "app version"})
            state["updated_at"] = 100
            store.app.save(state)
            project_store = store._project_store(root, create=True)
            project_copy = {**state, "messages": [*state["messages"], {"role": "user", "content": "project version"}], "updated_at": 200}
            project_store.save(project_copy)

            rows = store.list(str(root))
            loaded = store.load(state["session_id"], str(root))

            self.assertTrue(rows[0]["sync_conflict"])
            self.assertEqual(rows[0]["recommended_source"], "project")
            self.assertTrue(loaded["conflict"])
            self.assertEqual({row["source"] for row in loaded["versions"]}, {"app", "project"})
            self.assertEqual(len(store.app.load(state["session_id"])["messages"]), 2)
            self.assertEqual(len(project_store.load(state["session_id"])["messages"]), 3)

    def test_moved_project_uses_its_workspace_identity_for_old_session(self):
        with tempfile.TemporaryDirectory() as temp:
            old = Path(temp) / "old"
            new = Path(temp) / "new"
            old.mkdir()
            store = MirroredSessionStore(Path(temp) / "app")
            state = store.create(str(old), "model", 8192)
            store.save(state)
            new.mkdir()
            (new / ".agent-workbench").mkdir()
            (new / ".agent-workbench" / "workspace.json").write_bytes((old / ".agent-workbench" / "workspace.json").read_bytes())

            loaded = store.load(state["session_id"], str(new), source="app")

            self.assertFalse(loaded["conflict"])
            self.assertEqual(loaded["state"]["workspace"], str(new.resolve()))
            self.assertEqual(loaded["state"]["workspace_id"], state["workspace_id"])

    def test_project_mirror_failure_keeps_app_library_session(self):
        with tempfile.TemporaryDirectory() as temp:
            store = MirroredSessionStore(Path(temp) / "app")
            state = {"session_id": "portable-1", "workspace": str(Path(temp) / "missing"), "model": "m", "context": 1024, "messages": [], "updated_at": 1}
            result = store.save(state)
            self.assertTrue(result["app_saved"])
            self.assertFalse(result["project_saved"])
            self.assertEqual(store.app.load("portable-1")["session_id"], "portable-1")

    def test_git_ignore_is_default_and_can_be_disabled_for_project(self):
        import subprocess

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "project"
            root.mkdir()
            subprocess.run(["git", "init", str(root)], check=True, capture_output=True)
            store = MirroredSessionStore(Path(temp) / "app")
            state = store.create(str(root), "model", 8192)
            store.save(state)
            session_path = f".agent-workbench/sessions/{state['session_id']}.json"

            ignored = subprocess.run(["git", "-C", str(root), "check-ignore", "-q", session_path]).returncode
            store.set_track_sessions(str(root), True)
            tracked = subprocess.run(["git", "-C", str(root), "check-ignore", "-q", session_path]).returncode

            self.assertEqual(ignored, 0)
            self.assertEqual(tracked, 1)


class WorkspaceHistoryTests(unittest.TestCase):
    def test_history_keeps_missing_entries_searches_pins_and_removes_explicitly(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            existing = base / "existing"
            existing.mkdir()
            missing = base / "missing"
            history = WorkspaceHistory(base / "app")
            history.record(str(existing))
            history.record(str(missing), allow_missing=True)
            history.set_pinned(str(missing), True)

            rows = history.list("missing")

            self.assertEqual(len(rows), 1)
            self.assertFalse(rows[0]["available"])
            self.assertTrue(rows[0]["pinned"])
            history.remove(str(missing))
            self.assertEqual(len(history.list()), 1)


if __name__ == "__main__":
    unittest.main()
