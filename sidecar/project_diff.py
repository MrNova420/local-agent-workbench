from __future__ import annotations

import os
import subprocess
from pathlib import Path


_MAX_FILES = 200
_MAX_FILE_BYTES = 256 * 1024
_MAX_DIFF_CHARS = 1_000_000
_SKIP_DIRS = {".git", ".agent-workbench", "node_modules", "__pycache__", ".venv", "venv", "dist", "build", "coverage"}


def _git(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(root), *args], capture_output=True, text=True,
        timeout=15, check=False, shell=False,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


def _new_file_diff(root: Path, relative: Path) -> str:
    path = root / relative
    if path.is_symlink() or not path.is_file():
        return ""
    try:
        if path.resolve().parent != root and root not in path.resolve().parents:
            return ""
        raw = path.read_bytes()
    except OSError:
        return ""
    name = relative.as_posix()
    header = f"diff --git a/{name} b/{name}\nnew file mode 100644\n--- /dev/null\n+++ b/{name}\n"
    if len(raw) > _MAX_FILE_BYTES:
        return header + f"Binary or oversized file omitted ({len(raw)} bytes).\n"
    if b"\0" in raw:
        return header + "Binary file omitted.\n"
    content = raw.decode("utf-8", errors="replace")
    lines = content.splitlines()
    return header + f"@@ -0,0 +1,{len(lines)} @@\n" + "".join(f"+{line}\n" for line in lines)


def _project_files_diff(root: Path) -> str:
    chunks = [
        "Selected folder is not its own Git repository. Showing files in this folder as the current project snapshot; no earlier Git baseline is available.\n"
    ]
    count = 0
    total = len(chunks[0])
    for current, directories, files in os.walk(root, topdown=True, followlinks=False):
        current_path = Path(current)
        directories[:] = sorted(
            name for name in directories
            if name not in _SKIP_DIRS and not (current_path / name).is_symlink()
        )
        for filename in sorted(files):
            relative = (current_path / filename).relative_to(root)
            chunk = _new_file_diff(root, relative)
            if not chunk:
                continue
            if count >= _MAX_FILES or total + len(chunk) > _MAX_DIFF_CHARS:
                chunks.append("\nFurther files omitted because the review size limit was reached.\n")
                return "\n".join(chunks)
            chunks.append(chunk)
            count += 1
            total += len(chunk)
    if count == 0:
        return chunks[0] + "No files are available to preview.\n"
    return "\n".join(chunks)


def workspace_diff_text(workspace: str | Path) -> str:
    root = Path(workspace).resolve(strict=True)
    top = _git(root, "rev-parse", "--show-toplevel")
    if top.returncode != 0:
        return _project_files_diff(root)

    repository = Path(top.stdout.strip()).resolve()
    if repository != root:
        return _project_files_diff(root)

    tracked = _git(root, "diff", "--no-ext-diff", "--")
    if tracked.returncode != 0:
        return (tracked.stdout + tracked.stderr).strip() or "Could not read this project's Git diff."
    chunks = [tracked.stdout] if tracked.stdout else []
    status = _git(root, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ".")
    if status.returncode == 0:
        untracked = [
            record[3:] for record in status.stdout.split("\0")
            if record.startswith("?? ") and record[3:]
        ]
        omitted_files = max(0, len(untracked) - _MAX_FILES)
        for name in untracked[:_MAX_FILES]:
            chunk = _new_file_diff(root, Path(name))
            if not chunk:
                continue
            if sum(map(len, chunks)) + len(chunk) <= _MAX_DIFF_CHARS:
                chunks.append(chunk)
            else:
                omitted_files += 1
        if omitted_files:
            chunks.append(
                f"\nReview incomplete: {omitted_files} untracked file(s) omitted because preview size limits were reached. "
                "Use Git directly for a complete review.\n"
            )
    result = "\n".join(chunks).strip()
    return result or "No unstaged Git changes in this project."
