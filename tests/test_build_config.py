from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest


APP_ROOT = Path(__file__).resolve().parents[1]
HELPER_PATH = APP_ROOT / "scripts" / "verify_core_checkout.py"


def load_verifier():
    assert HELPER_PATH.is_file(), "builds must validate the paired engine revision"
    spec = importlib.util.spec_from_file_location("verify_core_checkout", HELPER_PATH)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def make_core_checkout(path: Path) -> str:
    path.mkdir()
    subprocess.run(["git", "init", "--quiet", "--initial-branch=main", str(path)], check=True)
    subprocess.run(["git", "-C", str(path), "config", "user.name", "Build Test"], check=True)
    subprocess.run(["git", "-C", str(path), "config", "user.email", "build-test@example.invalid"], check=True)
    (path / "desktop_engine.py").write_text("# fixture\n", encoding="utf-8")
    subprocess.run(["git", "-C", str(path), "add", "desktop_engine.py"], check=True)
    subprocess.run(["git", "-C", str(path), "commit", "--quiet", "-m", "fixture"], check=True)
    return subprocess.check_output(["git", "-C", str(path), "rev-parse", "HEAD"], text=True).strip()


def test_build_accepts_clean_engine_at_exact_pinned_revision(tmp_path: Path):
    core = tmp_path / "engine"
    revision = make_core_checkout(core)
    app = tmp_path / "app"
    app.mkdir()
    (app / "core-revision.txt").write_text(revision + "\n", encoding="utf-8")

    assert load_verifier().verify_core_checkout(app, core) == revision


def test_build_rejects_engine_revision_that_differs_from_app_pin(tmp_path: Path):
    core = tmp_path / "engine"
    actual = make_core_checkout(core)
    app = tmp_path / "app"
    app.mkdir()
    expected = "0" * len(actual)
    (app / "core-revision.txt").write_text(expected + "\n", encoding="utf-8")

    verifier = load_verifier()
    with pytest.raises(verifier.CoreRevisionError, match="does not match"):
        verifier.verify_core_checkout(app, core)


def test_build_rejects_dirty_engine_source_even_at_the_pinned_commit(tmp_path: Path):
    core = tmp_path / "engine"
    revision = make_core_checkout(core)
    app = tmp_path / "app"
    app.mkdir()
    (app / "core-revision.txt").write_text(revision + "\n", encoding="utf-8")
    (core / "uncommitted.py").write_text("not part of the pin\n", encoding="utf-8")

    verifier = load_verifier()
    with pytest.raises(verifier.CoreRevisionError, match="dirty"):
        verifier.verify_core_checkout(app, core)


def test_build_requires_the_engine_repository_root_not_a_subdirectory(tmp_path: Path):
    core = tmp_path / "engine"
    revision = make_core_checkout(core)
    app = tmp_path / "app"
    app.mkdir()
    (app / "core-revision.txt").write_text(revision + "\n", encoding="utf-8")
    nested = core / "nested"
    nested.mkdir()

    verifier = load_verifier()
    with pytest.raises(verifier.CoreRevisionError, match="repository root"):
        verifier.verify_core_checkout(app, nested)


def test_source_worker_rejects_mismatched_engine_before_importing_it(tmp_path: Path):
    core = tmp_path / "engine"
    actual = make_core_checkout(core)
    marker = tmp_path / "engine-imported.txt"
    (core / "desktop_engine.py").write_text(
        f"from pathlib import Path\nPath({str(marker)!r}).write_text('imported')\n", encoding="utf-8"
    )
    app = tmp_path / "app"
    scripts = app / "scripts"
    scripts.mkdir(parents=True)
    (scripts / "verify_core_checkout.py").write_bytes(HELPER_PATH.read_bytes())
    (app / "core-revision.txt").write_text("0" * len(actual) + "\n", encoding="utf-8")

    env = os.environ.copy()
    env["LOCAL_AGENT_CORE_PATH"] = str(core)
    env["LOCAL_AGENT_APP_ROOT"] = str(app)
    result = subprocess.run(
        [sys.executable, "-u", str(APP_ROOT / "sidecar" / "worker.py")],
        env=env,
        capture_output=True,
        text=True,
        timeout=8,
        check=False,
    )

    lines = [line for line in result.stdout.splitlines() if line.strip()]
    assert result.returncode != 0
    assert lines, result.stderr
    event = json.loads(lines[0])
    assert event["type"] == "startup_error"
    assert "does not match the app pin" in event["error"]
    assert not marker.exists(), "unpaired engine code must not be imported"


def test_local_sidecar_build_verifies_the_pin_before_running_pyinstaller():
    script = (APP_ROOT / "scripts" / "build-sidecar.ps1").read_text(encoding="utf-8")
    verifier = script.index("verify_core_checkout.py")
    pyinstaller = script.index("python -m PyInstaller")

    assert verifier < pyinstaller


@pytest.mark.parametrize("workflow", ["ci.yml", "release-windows.yml"])
def test_workflows_checkout_the_revision_recorded_by_the_app(workflow: str):
    text = (APP_ROOT / ".github" / "workflows" / workflow).read_text(encoding="utf-8")
    assert "core-revision.txt" in text
    assert "${{ steps.engine-pin.outputs.revision }}" in text
    assert "39ff5495256e12f5f7e43232f269e5ace8d1ff88" not in text


def test_default_make_routes_to_unique_candidate_output():
    package = json.loads((APP_ROOT / "package.json").read_text(encoding="utf-8"))
    scripts = package["scripts"]

    assert scripts["make"] == "npm run make:unique", (
        "the default make target must never overwrite an earlier candidate"
    )
    assert "make-unique.ps1" in scripts["make:unique"]
    # A fixed-output release build stays available, but only under its own name.
    assert "electron-forge make" in scripts["make:release"]


def test_sidecar_build_honours_isolated_worker_paths():
    script = (APP_ROOT / "scripts" / "build-sidecar.ps1").read_text(encoding="utf-8")

    assert "LOCAL_AGENT_WORKER_OUT_DIR" in script, "candidate builds must isolate the bundled worker"
    assert "LOCAL_AGENT_WORKER_WORK_DIR" in script, "PyInstaller intermediates must stay in the candidate"
    # Defaults still point at the repository path for the release build.
    assert r"sidecar\dist" in script
    assert r"sidecar\build" in script


def test_forge_packages_the_worker_from_the_isolated_path():
    config = (APP_ROOT / "forge.config.ts").read_text(encoding="utf-8")

    assert "LOCAL_AGENT_WORKER_OUT_DIR" in config, (
        "Forge must package the candidate worker, not a stale shared binary"
    )
    assert "agent-worker.exe" in config


def test_unique_candidate_builder_refuses_to_overwrite_and_records_provenance():
    script = (APP_ROOT / "scripts" / "make-unique.ps1").read_text(encoding="utf-8")

    assert "Test-Path -LiteralPath $OutputPath" in script, "an existing candidate directory must abort"
    assert "throw" in script
    assert "candidate-manifest.json" in script
    for field in ("app_commit", "engine_commit", "engine_pin", "package_lock_sha256",
                  "node_version", "npm_version", "python_version", "pyinstaller_version"):
        assert field in script, f"candidate manifest must record {field}"
    # Candidate artefacts, worker output and work files share one unique root.
    assert "LOCAL_AGENT_OUT_DIR" in script
    assert "LOCAL_AGENT_WORKER_OUT_DIR" in script


def test_unique_candidate_builder_restores_previous_environment():
    script = (APP_ROOT / "scripts" / "make-unique.ps1").read_text(encoding="utf-8")

    for name in ("LOCAL_AGENT_OUT_DIR", "LOCAL_AGENT_WORKER_OUT_DIR", "LOCAL_AGENT_WORKER_WORK_DIR"):
        assert f"$Previous" in script or f"Previous" in script
    assert "finally" in script, "environment variables must be restored even when packaging fails"
