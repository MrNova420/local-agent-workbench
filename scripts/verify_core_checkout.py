"""Verify that a local agent-engine checkout matches the desktop app pin."""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path


_REVISION = re.compile(r"^(?:[0-9a-f]{40}|[0-9a-f]{64})$")


class CoreRevisionError(RuntimeError):
    """Raised when the engine source cannot be proven to match the app pin."""


def _git(core_path: Path, *args: str) -> str:
    try:
        result = subprocess.run(
            ["git", "-C", str(core_path), *args],
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        detail = getattr(exc, "stderr", "") or str(exc)
        raise CoreRevisionError(f"cannot verify the agent engine Git checkout at {core_path}: {detail.strip()}") from exc
    return result.stdout.strip()


def verify_core_checkout(app_root: Path, core_path: Path) -> str:
    """Return the pinned engine revision, rejecting mismatched or dirty source."""
    app_root = Path(app_root).resolve()
    core_path = Path(core_path).resolve()
    if not core_path.is_dir():
        raise CoreRevisionError(f"agent engine checkout does not exist: {core_path}")

    pin_path = app_root / "core-revision.txt"
    try:
        expected = pin_path.read_text(encoding="utf-8").strip()
    except OSError as exc:
        raise CoreRevisionError(f"cannot read the app's paired engine pin: {pin_path}") from exc
    if not _REVISION.fullmatch(expected):
        raise CoreRevisionError(f"invalid agent engine revision in {pin_path}; expected a full Git object ID")

    repository_root = Path(_git(core_path, "rev-parse", "--show-toplevel")).resolve()
    if repository_root != core_path:
        raise CoreRevisionError(
            f"agent engine path must be the repository root, not a subdirectory: {core_path}; root is {repository_root}"
        )

    actual = _git(core_path, "rev-parse", "HEAD")
    if actual != expected:
        raise CoreRevisionError(
            f"agent engine revision does not match the app pin: expected {expected}, found {actual} at {core_path}"
        )

    changes = _git(core_path, "status", "--porcelain", "--untracked-files=all")
    if changes:
        raise CoreRevisionError(
            f"agent engine checkout at {core_path} is dirty; commit or clean its changes before packaging revision {expected}"
        )
    return actual


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--app-root", type=Path, required=True)
    parser.add_argument("--core-path", type=Path, required=True)
    args = parser.parse_args()
    try:
        verify_core_checkout(args.app_root, args.core_path)
    except CoreRevisionError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    print(Path(args.core_path).resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
