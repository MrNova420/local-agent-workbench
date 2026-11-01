# Session Continuity and Run Recovery Implementation

**Status:** source implementation in progress; verification intentionally queued.  
**Applies to:** Electron workbench plus its pinned shared Python engine.  
**Settings:** selected context, maximum output, and model-default reasoning are not changed.

## Implemented in this source batch

- A session-owned task checkpoint now carries the original goal, user follow-up instructions, captured runtime settings, plan, completed operation references, changed files, verification, and the latest assistant update. Complete transcript, emitted reasoning, and complete tool results remain in session history/activity.
- The engine injects that checkpoint on each inference request, including after complete-turn compaction. Compaction records the omitted and retained turn counts and checkpoint inclusion/estimated size. The checkpoint supplements history; it does not replace the configured context or output cap.
- When a new task starts, the immediately preceding archived task's outcome, plan, blockers, decisions, changed files, and verification are also summarized into the checkpoint request. Complete task history remains saved; the model receives this prior summary only alongside the active task checkpoint.
- Legacy flat checkpoints are migrated into the current task shape. Completed, cancelled, failed, and stopped tasks are retained in task history when a later task starts.
- Ollama prompt_eval_cached_count is now retained by the shared runtime adapter. Usage events are stored with turn, model/provider, and run settings.
- Sidecar plan updates already used the durable activity stream. The renderer now also updates the visible Plan section from those same activity events; it no longer waits for a separate ephemeral plan event.
- Run event deltas are coalesced and appended to per-session JSONL journals in both app and project stores. Streamed text/reasoning and command output flush at intervals; operation, plan, compaction, usage, and terminal boundaries flush immediately. A journal cursor lets session recovery replay only events newer than its last snapshot. Duplicate app/project journal records use shared event IDs.
- Each journal event now tracks which mirror durably accepted it. A failed project or app append is retried only to the missing mirror; already-saved stream chunks are no longer mutated by coalescing, and a session cursor advances only for events present in both mirrors. Session listings replay the selected/consistent journal so active/interrupted status is current.
- Full JSON snapshots are now written at important boundaries and at a slower interval during streaming, instead of once per second. Temporary Windows PermissionError replace failures receive bounded exponential retry. The save result reports app and project success independently; the UI no longer claims the app copy succeeded when it did not.
- Recovery replays post-snapshot partial text, reasoning, plan updates, operation start/output/result, generation usage, and terminal state. Text already received before a provider error is retained in the transcript. Malformed or unreadable journal records are surfaced in the Activity Trace and a warning; original journal bytes are preserved. Interrupted writes remain uncertain and are never automatically retried.
- Before a follow-up inference request clears the previous request's streaming buffer, its completed assistant text and reasoning are copied into the recoverable message checkpoint. Terminal replay also updates the task checkpoint status and blocker/verification fields.
- Terminal workflow outcomes are stored separately from run completion: discussion, plan-only, blocked, changed, inspected, command-completed, and command-failed. The renderer labels these from host-observed actions; it does not equate command completion with passing tests. A new task clears the previous task's visible plan, while active follow-ups keep it.
- The sidecar now forwards the engine's successful terminal outcome to the renderer only after session persistence, matching cancellation/error ordering. A missing successful terminal event is saved as a failure with a checkpoint blocker rather than silently labeled discussion; queued worker and persistence checks cover event ordering and fail-closed recovery.

## Verification queue (not run in this implementation phase)

1. Unit-test task checkpoint continuation, legacy migration, task history, operation references, and plan updates.
2. Fault-inject app/project snapshot lock errors, asymmetric one-store journal failure and targeted retry, both-store journal failure, duplicate journal records, truncated final JSONL lines, and restart between tool start and completion.
3. Verify a completed response is reconstructed if the process exits after final stream events but before the session snapshot.
4. Exercise live Plan updates from model update_plan through sidecar, JSONL, renderer, and reopened session.
5. Confirm long streaming output and Unicode survive a process restart with no duplication, loss, or automatic replay of completed operations.
6. Confirm received text/reasoning remains visible after provider errors, and malformed journal data is reported without being rewritten or discarded.
7. Verify the full success event path emits the observed outcome after persistence, errors remain terminal, missing completion evidence fails closed, and resumed sessions preserve the distinction between command completion and test success. Worker regressions now assert event order and the fail-closed state; still unrun.
8. Verify cached prompt-token reporting for Ollama and llama.cpp and distinguish provider-exact counts from estimates in the UI.
9. Run the full engine, sidecar, renderer, typecheck, packaged-app, and visible acceptance gates only after all implementation work is complete.

## Remaining reliability work

- Reconcile the exact shared-engine and desktop source revisions, update every engine SHA pin, and package only after implementation is complete.
- Test and harden simultaneous session writes, read-only project mirrors, project moves, copy conflicts, app startup recovery, and migration from older saved sessions.
- Add retention/export controls before any journal compaction or deletion policy; do not discard activity or transcript records silently.
- Add persisted context/input usage presentation and distinguish actual runtime allocation from selected context where the provider exposes it.
- Continue the approved core harness plan: host-generated substantial-task plans and explicit task intent, assembled-prompt/source preview and exact skill-inclusion evidence, provider capability reporting, permissions and process containment, developer tooling parity, task-specific verification contracts, transcript rendering after reopen, and remaining product backlog. Workbench-owned skill enable/source controls and host-observed terminal outcomes are implemented but unverified. See MASTER_ROADMAP.md, CORE_HARNESS_READINESS.md, and PRODUCT_BACKLOG.md.

No live model, app process, OpenCode setting, selected token value, model reasoning default, or runtime placement was changed for this work.
