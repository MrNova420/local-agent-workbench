# Public beta release runbook

## Supported artifact

The current distributable is a **Windows 10/11 x64** Squirrel.Windows installer plus a portable ZIP. It bundles the Python sidecar and the exact engine revision in `core-revision.txt`. It does not bundle Ollama, llama.cpp, or model weights. The release is unsigned today; Windows SmartScreen may show an unknown-publisher warning. Do not describe this as signed or universally installable on macOS/Linux/ARM.

## Release sequence

1. Update the app version in `package.json` and `package-lock.json`; ensure the SemVer value matches the `v`-prefixed Git tag.
2. Update `core-revision.txt` and both workflow engine checkouts together when the shared Python engine changes.
3. Run the app typecheck, app/sidecar tests, engine tests, Windows package build, bundled-worker protocol smoke, and the visible install/update workflow. A successful source test run alone is not a packaged release gate.
4. Inspect `out/make/squirrel.windows/x64/`: keep `RELEASES`, Setup `.exe`, and `*-full.nupkg` together. Keep the ZIP and `SHA256SUMS.txt` in the release assets too.
5. Publish a GitHub Release from the matching `v<version>` tag and write user-facing notes from `CHANGELOG.md`. The Windows auto-update service consumes public, non-draft GitHub Releases and requires the Squirrel manifest and package assets. The release workflow therefore leaves GitHub's prerelease checkbox off while the SemVer version/title still says **Public beta**. Do not publish a draft or use GitHub's prerelease flag: the public Electron update service does not discover those releases.
6. Install the previous release in a clean Windows x64 environment. Verify update discovery, background download, visible ready state, no restart during a task, explicit restart/install, and recovery of workspace/session data afterward.
7. Verify the downloaded artifacts against `SHA256SUMS.txt`; verify the release page, setup instructions, screenshots, changelog, and platform limitations before announcing it.

## Version and release policy

- Documentation-only, planning, and repository-governance commits do not change the app version, create a tag, or publish a release. A version is selected only when a distributable app build has passed the release gates below.
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
4. Exercise the packaged app visibly in a disposable workspace, including the real updater path from the previous installed version. Preserve any model already loaded before an approved inference check.
5. Review release notes, setup/recovery instructions, screenshots for current-build accuracy and privacy, known limitations, license, and security reporting path.
6. Only after all required gates pass, choose and commit the next SemVer version, then tag that exact commit and confirm the public release has all required assets and updater-compatible flags.

Never force-move a published tag to repair an artifact. If an artifact is wrong, publish a new patch after documenting the issue and recovery path. Do not promise automatic rollback: users control installation/restart, and recovery instructions must explain reinstalling the previous known-good version while preserving user data.

## Update safety behavior

- Only installed, packaged Windows x64 builds use the public update feed.
- Checks begin after Squirrel's first-run window and recur every six hours while no model task is active. A detected update downloads in the background.
- The app does not restart automatically. **Restart and update** is shown only after download completes and is disabled while a run is active.
- Development builds and unsupported platforms report updates as unavailable.
- The updater is useful only after the public release contains all Squirrel assets. A ZIP, Setup executable alone, or GitHub tag without a Release will not work as an update source.
- No code-signing identity is configured. HTTPS, GitHub's public release infrastructure, Squirrel package hashes, and published SHA-256 checksums are not a substitute for an Authenticode signature or supply-chain attestation.

## Current release evidence

The public app remains at the already published beta.2 until a later distributable build passes the gates above. Documentation and planning work does not advance its version. User-reported end-to-end website development is recorded in `ACCEPTANCE_LOG.md`; installed updater discovery and an actual upgrade cycle, current-build screenshots, and cross-platform packages remain separate acceptance items.

## Upstream references

- [Electron: updating applications](https://www.electronjs.org/docs/latest/tutorial/updates)
- [Electron update.electronjs.org service](https://github.com/electron/update.electronjs.org/blob/main/README.md)
- [GitHub Actions environments and deployment protection](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
