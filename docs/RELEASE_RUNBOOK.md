# Public beta release runbook

## Supported artifact

The current distributable is a **Windows 10/11 x64** Squirrel.Windows installer plus a portable ZIP. It bundles the Python sidecar and the exact engine revision in `core-revision.txt`. It does not bundle Ollama, llama.cpp, or model weights. The release is unsigned today; Windows SmartScreen may show an unknown-publisher warning. Do not describe this as signed or universally installable on macOS/Linux/ARM.

## Release sequence

1. Update the app version in `package.json` and `package-lock.json`; ensure the SemVer value matches the `v`-prefixed Git tag.
2. Update `core-revision.txt` and both workflow engine checkouts together when the shared Python engine changes.
3. Run the app typecheck, app/sidecar tests, engine tests, Windows package build, bundled-worker protocol smoke, and visible disposable-project workflow. For engineering candidates use `npm run make:unique`, which places every build in a fresh `out/candidates/candidate-<timestamp>-<id>` directory and refuses an existing path. Do not overwrite or install over an earlier candidate; keep older artifacts available for comparison/recovery. The installed update canary is post-publication step 7 because the candidate cannot be discovered on the public feed before release.
4. Inspect `out/make/squirrel.windows/x64/`: keep `RELEASES`, Setup `.exe`, and `*-full.nupkg` together. Keep the ZIP and `SHA256SUMS.txt` in the release assets too.
5. Publish a GitHub Release from the matching `v<version>` tag and write user-facing notes from `CHANGELOG.md`. The Windows auto-update service consumes public, non-draft GitHub Releases and requires the Squirrel manifest and package assets. The release workflow therefore leaves GitHub's prerelease checkbox off while the SemVer version/title still says **Public beta**. Do not publish a draft or use GitHub's prerelease flag: the public Electron update service does not discover those releases.
6. Verify the downloaded artifacts against `SHA256SUMS.txt`; verify the release page, setup instructions, screenshots, changelog, and platform limitations before announcing it.
7. After publication, perform the installed-update canary from the previous release: verify discovery, background download, visible ready state, no restart during a task, explicit restart/install, and workspace/session recovery. If the canary fails, document the affected users and publish a corrected patch rather than moving the tag.

## Version and release policy

- Documentation-only, planning, and repository-governance commits do not change the app version, create a tag, or publish a release. A version is selected only when a distributable app build has passed the release gates below.
- Candidate package builds must use a unique output directory. Never reuse a candidate directory or replace an older installer/ZIP; immutable historical candidates are needed for comparison and recovery. The release output for the final tagged build is also retained under a new version-specific path.
- Give every published app release a new, strictly increasing SemVer tag matching `package.json` and `package-lock.json`. Never move or reuse a published tag.
- The tag workflow packages the exact app commit and checks out the shared engine commit pinned by `core-revision.txt` and both workflows. Push the paired engine commit first whenever that pin changes, then publish the app source commit that references it.
- Keep the beta designation in the tag, app version, release title, and notes. Leave GitHub's **prerelease** checkbox off because the configured Electron public update feed does not discover GitHub-marked prereleases.
- Publish only after the final verification and artifact review. A tag triggers the public release workflow; it is not a staging channel. Users get background download and a visible **Restart and update** action in Settings, never a forced restart during a run.
- Attach the complete Squirrel set (`RELEASES`, Setup executable, full `.nupkg`) and portable ZIP plus checksums to every update release. A tag or Setup executable by itself cannot update an installed Squirrel app.

The tag workflow performs typecheck, app/sidecar and engine tests, packages the Windows app, writes checksums, and publishes the required assets. If GitHub Actions is unavailable, use the exact same steps locally and record the limitation; do not claim the workflow passed.

## Pre-tag release gate

Before creating a public tag, complete and record each gate in `MASTER_ROADMAP.md` and `ACCEPTANCE_LOG.md`:

1. Reconcile the app and paired engine source commits; verify the engine SHA is public and identical in every app pin.
2. Run engine pytest; app sidecar and renderer suites; typecheck; workflow validation; and focused fault-injection from the exact clean source tree. Resolve hosted runner availability or record a reproducible local equivalent without calling blocked CI a pass.
3. Build the Windows package; inspect installer, `RELEASES`, `.nupkg`, ZIP, checksum manifest, and bundled worker startup/ping/shutdown.
4. Exercise the packaged app visibly in a disposable workspace and review updater readiness, feed URL, and required assets. Preserve any model already loaded before an approved inference check.
5. Review release notes, setup/recovery instructions, screenshots for current-build accuracy and privacy, known limitations, license, and security reporting path.
6. After source tests pass and before packaging, choose the next SemVer version and commit matching package manifests and release notes. Build and visibly inspect that exact version. Create its immutable tag only after those pre-publication gates pass; then confirm the public release has all required assets and updater-compatible flags. The installed-update canary is a post-publication gate because the update feed cannot serve a release that does not exist yet.

Never force-move a published tag to repair an artifact. If an artifact is wrong, publish a new patch after documenting the issue and recovery path. Do not promise automatic rollback: users control installation/restart, and recovery instructions must explain reinstalling the previous known-good version while preserving user data.

## Update safety behavior

- Only installed, packaged Windows x64 builds use the public update feed.
- Checks begin after Squirrel's first-run window and recur every six hours while no model task is active. A detected update downloads in the background.
- The app does not restart automatically. **Restart and update** is shown only after download completes and is disabled while a run is active.
- Development builds and unsupported platforms report updates as unavailable.
- The updater is useful only after the public release contains all Squirrel assets. A ZIP, Setup executable alone, or GitHub tag without a Release will not work as an update source.
- No code-signing identity is configured. HTTPS, GitHub's public release infrastructure, Squirrel package hashes, and published SHA-256 checksums are not a substitute for an Authenticode signature or supply-chain attestation.

## Current release evidence

The public [GitHub releases page](https://github.com/MrNova420/local-agent-workbench/releases) was checked on 2026-11-07 and lists `v0.1.0-beta.2` as Latest. The [`v0.1.0-beta.3` tag](https://github.com/MrNova420/local-agent-workbench/releases/tag/v0.1.0-beta.3) exists, but is not listed as a published release on the Releases page. Do not reuse or move that tag. The current local pair is app source `cdd5a1c38acf01ddc7584d99512977ed4e06accf` / engine `aece45546bf2c22ac838eb6f481974a505f253a0`; exact-pair tests, typecheck, package build, and worker handshake passed. Current-build visible acceptance is not established: a CUA launch by the candidate path surfaced the installed beta.3 executable, so executable identity must be isolated before the visible gate can pass. Installer/updater recovery, long-run compaction, and current-build multi-operation workflow remain open. No version bump or release is staged. After gates pass, the next version must be strictly greater than beta.3; `0.1.0-beta.4` is the natural next candidate, but version files and tag should change only for the exact release commit after pre-tag gates pass. Documentation-only work does not advance the app version. User-reported website development remains recorded separately as historical user-reported evidence.

## Upstream references

- [Electron: updating applications](https://www.electronjs.org/docs/latest/tutorial/updates)
- [Electron update.electronjs.org service](https://github.com/electron/update.electronjs.org/blob/main/README.md)
- [GitHub Actions environments and deployment protection](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
## Beta update visibility

The Windows Squirrel feed uses Electron's public `update.electronjs.org` service. The service ignores GitHub Releases marked `prerelease: true`, so the workflow must publish beta SemVer tags such as `0.1.0-beta.4` with GitHub's `prerelease: false` field. The tag still communicates beta stability; the release metadata makes it discoverable to the updater. Keep the auto-updater check serialized: a second call can start a duplicate download, and a periodic check must not replace the `downloaded` state before the user chooses to restart. This contract is source-covered; installed old-to-new upgrade and recovery remain a separate acceptance gate.
