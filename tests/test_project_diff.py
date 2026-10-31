import subprocess
from pathlib import Path

from sidecar.project_diff import workspace_diff_text


def _git(root: Path, *args: str) -> None:
    subprocess.run(["git", "-C", str(root), *args], check=True, capture_output=True)


def test_nested_workspace_never_displays_parent_repository_changes(tmp_path):
    parent = tmp_path / "parent"
    workspace = parent / "work" / "fixture"
    workspace.mkdir(parents=True)
    _git(parent, "init", "-q")
    (parent / "parent-secret.txt").write_text("parent baseline\n", encoding="utf-8")
    _git(parent, "add", "parent-secret.txt")
    (parent / "parent-secret.txt").write_text("parent-only changed content\n", encoding="utf-8")
    (workspace / "calculator.py").write_text("def add(a, b):\n    return a + b\n", encoding="utf-8")

    result = workspace_diff_text(workspace)

    assert "calculator.py" in result
    assert "+def add(a, b):" in result
    assert "Selected folder is not its own Git repository" in result
    assert "parent-only changed content" not in result
    assert "parent-secret.txt" not in result


def test_repository_diff_includes_untracked_project_files(tmp_path):
    root = tmp_path / "project"
    root.mkdir()
    _git(root, "init", "-q")
    (root / "new module.py").write_text("value = 42\n", encoding="utf-8")

    result = workspace_diff_text(root)

    assert "new module.py" in result
    assert "+value = 42" in result
