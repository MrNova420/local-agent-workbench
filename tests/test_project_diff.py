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


def test_repository_diff_includes_every_untracked_file_and_complete_large_file(tmp_path):
    root = tmp_path / "project"
    root.mkdir()
    _git(root, "init", "-q")
    for index in range(205):
        (root / f"file-{index:03}.txt").write_text(f"file {index}\n", encoding="utf-8")
    large_tail = "complete tail beyond the former 256 KiB limit"
    (root / "large.txt").write_text(("0123456789abcdef\n" * 80_000) + large_tail + "\n", encoding="utf-8")

    result = workspace_diff_text(root)

    assert "file-000.txt" in result
    assert "file-204.txt" in result
    assert large_tail in result
    assert "Review incomplete" not in result
    assert "omitted" not in result


def test_non_git_project_review_excludes_private_workbench_session_data(tmp_path):
    root = tmp_path / "project"
    root.mkdir()
    (root / "app.py").write_text("print('hello')\n", encoding="utf-8")
    private = root / ".agent-workbench" / "sessions" / "private.json"
    private.parent.mkdir(parents=True)
    private.write_text('{"messages":[{"content":"private conversation"}]}', encoding="utf-8")
    nested_private = root / "packages" / "demo" / ".agent-workbench" / "sessions" / "nested.json"
    nested_private.parent.mkdir(parents=True)
    nested_private.write_text('{"messages":[{"content":"nested private conversation"}]}', encoding="utf-8")

    result = workspace_diff_text(root)

    assert "app.py" in result
    assert "private.json" not in result
    assert "private conversation" not in result
    assert "nested.json" not in result
    assert "nested private conversation" not in result


def test_git_project_review_includes_explicitly_tracked_workbench_session_data(tmp_path):
    root = tmp_path / "project"
    root.mkdir()
    _git(root, "init", "-q")
    private = root / ".agent-workbench" / "sessions" / "private.json"
    private.parent.mkdir(parents=True)
    private.write_text('{"messages":[{"content":"private baseline"}]}', encoding="utf-8")
    _git(root, "add", "-f", ".agent-workbench/sessions/private.json")
    _git(root, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "baseline")
    private.write_text('{"messages":[{"content":"private changed content"}]}', encoding="utf-8")
    (root / "app.py").write_text("print('hello')\n", encoding="utf-8")

    result = workspace_diff_text(root)

    assert "app.py" in result
    assert "private.json" in result
    assert "private changed content" in result
