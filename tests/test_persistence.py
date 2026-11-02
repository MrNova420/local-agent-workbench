import json
import tempfile
import unittest
from pathlib import Path

from sidecar.persistence import MirroredSessionStore, WorkspaceHistory, _replay_run_event


class MirroredSessionStoreTests(unittest.TestCase):
    def test_recovery_retains_checkpoint_and_in_task_compaction_metadata(self):
        state = {"session_id": "s-context", "workspace": "C:/project",
                 "run_state": {"turn_id": "turn-context"}, "activity_events": []}
        _replay_run_event(state, {"type": "context_compacted", "turnId": "turn-context",
                                  "omittedTurns": 3, "retainedTurns": 2, "omittedOperationGroups": 5,
                                  "configuredContext": 65536, "inputBudget": 63488,
                                  "checkpointIncluded": True, "checkpointEstimate": 420,
                                  "checkpointCompacted": True,
                                  "checkpointOmissions": {"operations": 18, "user_updates": 7}})
        activity = state["activity_events"][0]
        self.assertEqual(activity["omittedOperationGroups"], 5)
        self.assertTrue(activity["checkpointCompacted"])
        self.assertEqual(activity["checkpointOmissions"], {"operations": 18, "user_updates": 7})

    def test_tool_preparation_progress_replays_as_safe_session_activity(self):
        state = {"session_id": "s-progress", "workspace": "C:/project",
                 "run_state": {"turn_id": "turn-progress"}, "activity_events": []}
        _replay_run_event(state, {"type": "tool_call_progress", "activityId": "tool-call:turn-progress:0:1",
                                  "turnId": "turn-progress", "workspace": "C:/project", "provider": "ollama",
                                  "request_index": 0, "call_index": 1, "tool_name": "write_file",
                                  "argument_characters": 768, "timestamp": 12})
        row = state["activity_events"][0]
        self.assertEqual((row["kind"], row["name"], row["status"]), ("tool_preparation", "write_file", "preparing"))
        self.assertEqual(row["argumentCharacters"], 768)
        self.assertNotIn("arguments", row)
        _replay_run_event(state, {"type": "tool_batch", "request_index": 0,
                                  "assistantMessage": {"role": "assistant"}, "calls": []})
        self.assertEqual(state["activity_events"][0]["status"], "assembled")

        state["activity_events"][0]["status"] = "preparing"
        _replay_run_event(state, {"type": "request_error", "request_index": 0,
                                  "turnId": "turn-progress", "error": "connection ended"})
        self.assertEqual(state["activity_events"][0]["status"], "interrupted")

    def test_journal_recovery_preserves_uncertain_remote_tool_effects(self):
        state = {
            "session_id": "s-mcp", "workspace": "C:/project",
            "run_state": {"turn_id": "turn-mcp", "safe_messages": []},
            "activity_events": [],
        }
        _replay_run_event(state, {"type": "tool_start", "turnId": "turn-mcp", "operationId": "op-mcp",
                                  "toolCallId": "call-mcp", "name": "mcp__calendar__create_event",
                                  "arguments": {"title": "Review"}, "startedAt": 1})
        _replay_run_event(state, {"type": "tool_done", "turnId": "turn-mcp", "operationId": "op-mcp",
                                  "toolCallId": "call-mcp", "name": "mcp__calendar__create_event",
                                  "result": "Uncertain: response lost after dispatch", "status": "uncertain",
                                  "affectedFiles": [], "completedAt": 2})

        operation = state["run_state"]["uncertain_operation"]
        self.assertEqual(operation["name"], "mcp__calendar__create_event")
        self.assertEqual(operation["arguments"], {"title": "Review"})
        self.assertEqual([item["operationId"] for item in state["run_state"]["uncertain_operations"]], ["op-mcp"])
        self.assertEqual(state["activity_events"][0]["status"], "uncertain")

    def test_event_replay_keeps_other_active_operations_when_one_finishes(self):
        state = {"session_id": "s-parallel", "workspace": "C:/project",
                 "run_state": {"turn_id": "turn-parallel", "safe_messages": []}, "activity_events": []}
        for operation_id, call_id in (("op-a", "call-a"), ("op-b", "call-b")):
            _replay_run_event(state, {"type": "tool_start", "turnId": "turn-parallel", "operationId": operation_id,
                                      "toolCallId": call_id, "name": "read_file", "arguments": {"path": f"{call_id}.py"}})
        _replay_run_event(state, {"type": "tool_done", "turnId": "turn-parallel", "operationId": "op-a",
                                  "toolCallId": "call-a", "name": "read_file", "result": "A", "status": "completed"})

        self.assertEqual(set(state["run_state"]["active_operations"]), {"op-b"})
        self.assertEqual(state["run_state"]["active_operation"]["operationId"], "op-b")

    def test_question_request_and_answer_replay_as_durable_activity(self):
        state = {"session_id": "s-question", "workspace": "C:/project",
                 "run_state": {"turn_id": "turn-question", "safe_messages": []}, "activity_events": []}
        _replay_run_event(state, {"type": "question_request", "turnId": "turn-question",
                                  "questionId": "q-1", "operationId": "op-1", "workspace": "C:/project",
                                  "title": "Choose", "question": "Which framework?",
                                  "options": [{"label": "React"}]})
        _replay_run_event(state, {"type": "question_answered", "turnId": "turn-question",
                                  "questionId": "q-1", "status": "answered", "answer": "React"})

        self.assertEqual(len(state["activity_events"]), 1)
        self.assertEqual(state["activity_events"][0]["kind"], "question")
        self.assertEqual(state["activity_events"][0]["status"], "answered")
        self.assertEqual(state["activity_events"][0]["answer"], "React")

    def test_journal_recovery_attaches_exact_provider_settings_to_matching_prompt_request(self):
        state = {
            "session_id": "s-provider", "workspace": "C:/project",
            "run_state": {"turn_id": "turn-provider", "estimated_input_tokens": None},
            "activity_events": [],
        }
        _replay_run_event(state, {"type": "prompt_manifest", "activityId": "turn-provider-request-2",
                                  "turnId": "turn-provider", "request_index": 2,
                                  "messages": [], "configured_context": 65536})
        _replay_run_event(state, {"type": "inference_settings", "turnId": "turn-provider",
                                  "request_index": 2, "provider": "ollama", "request_api": "/api/chat",
                                  "model": "ornith:latest", "api_model": "ornith:latest", "stream": True,
                                  "tool_count": 2, "tool_names": ["read_file", "load_tools"],
                                  "deferred_tool_names": ["mcp__build__check"], "requested_context": 65536,
                                  "max_output_tokens": 8192, "reasoning_override": None,
                                  "reasoning_field_sent": False, "keep_alive": "3h",
                                  "request_options": {"num_ctx": 65536, "num_predict": 8192},
                                  "additional_fields": {},
                                  "estimated_input_tokens": 4100,
                                  "input_estimate_method": "conservative estimate"})
        _replay_run_event(state, {"type": "request_dispatched", "turnId": "turn-provider", "request_index": 2})
        self.assertEqual(state["activity_events"][0]["status"], "awaiting_response_headers")
        _replay_run_event(state, {"type": "request_headers", "turnId": "turn-provider", "request_index": 2,
                                  "http_status": 200, "http_reason": "OK", "header_wait_seconds": 1.25})
        _replay_run_event(state, {"type": "request_complete", "turnId": "turn-provider", "request_index": 2,
                                  "provider_done": True, "provider_done_reason": "length"})
        _replay_run_event(state, {"type": "generation_usage", "turnId": "turn-provider",
                                  "request_index": 2, "usage": {"prompt_eval_count": 4000,
                                                                     "prompt_eval_cached_count": 3200,
                                                                     "eval_count": 42}})

        prompt = state["activity_events"][0]
        self.assertEqual(prompt["id"], "turn-provider-request-2")
        self.assertEqual(prompt["providerRequest"]["request_options"], {"num_ctx": 65536, "num_predict": 8192})
        self.assertEqual(prompt["providerRequest"]["tool_names"], ["read_file", "load_tools"])
        self.assertEqual(prompt["providerRequest"]["deferred_tool_names"], ["mcp__build__check"])
        self.assertEqual(prompt["providerRequest"]["additional_fields"], {})
        self.assertFalse(prompt["providerRequest"]["reasoning_field_sent"])
        self.assertEqual(prompt["providerRequest"]["keep_alive"], "3h")
        self.assertEqual(prompt["providerRequest"]["api_model"], "ornith:latest")
        self.assertEqual(prompt["providerRequest"]["tool_count"], 2)
        self.assertEqual(prompt["providerUsage"]["prompt_eval_count"], 4000)
        self.assertEqual(prompt["providerUsage"]["prompt_eval_cached_count"], 3200)
        self.assertEqual(prompt["status"], "response_stream_ended")
        self.assertEqual(prompt["providerRequest"]["http_status"], 200)
        self.assertEqual(prompt["providerRequest"]["header_wait_seconds"], 1.25)
        self.assertEqual(prompt["providerRequest"]["provider_done_reason"], "length")

    def test_new_task_plan_snapshot_clears_prior_acceptance_criteria_on_replay(self):
        state = {
            "session_id": "s1", "workspace": "C:/project", "plan": [{"title": "Old"}],
            "task_checkpoint": {"current": {"plan": [{"title": "Old"}],
                                                "acceptance_criteria": ["Old criterion"],
                                                "acceptance_criteria_source": "agent"}},
        }
        _replay_run_event(state, {"type": "plan", "turnId": "new-turn", "source": "workbench",
                                  "items": [], "acceptanceCriteria": []})

        self.assertEqual(state["task_checkpoint"]["current"]["acceptance_criteria"], [])
        self.assertEqual(state["task_checkpoint"]["current"]["acceptance_criteria_source"], "awaiting_agent_refinement")
        self.assertEqual(state["activity_events"][-1]["acceptanceCriteria"], [])

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

    def test_session_approval_grant_is_not_trusted_when_mirrors_diverge_or_project_copy_is_missing(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "project"
            root.mkdir()
            store = MirroredSessionStore(Path(temp) / "app")
            state = store.create(str(root), "model", 8192)
            store.save(state)

            state["session_approval_granted"] = True
            store.app.save(state)
            loaded = store.load(state["session_id"])
            self.assertTrue(loaded["conflict"])
            self.assertEqual(loaded["recommended_source"], "project")

            project_path = root / ".agent-workbench" / "sessions" / f"{state['session_id']}.json"
            project_path.unlink()
            app_only = store.load(state["session_id"])
            self.assertFalse(app_only["session_approval_granted"])

            store.save(state)
            project_store = store._project_store(root)
            project_state = project_store.load(state["session_id"])
            project_state["session_approval_granted"] = True
            project_store.save(project_state)
            store.app.save(project_state)
            mirrored = store.load(state["session_id"])
            self.assertTrue(mirrored["session_approval_granted"])

    def test_event_journal_replays_partial_text_plan_and_uncertain_tool_state(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "project"
            root.mkdir()
            store = MirroredSessionStore(Path(temp) / "app")
            state = store.create(str(root), "model", 65536)
            state["task_checkpoint"] = {"current": {"task_id": "task-1", "plan": []}}
            state["run_state"] = {"status": "running", "turn_id": "turn-1", "safe_messages": [],
                                  "partial_content": "", "partial_thinking": "", "active_operation": None}
            store.save(state)
            appended = store.append_events(state["session_id"], str(root), [
                {"_journal_event_id": "evt-1", "_journal_recorded_at_ns": 1, "type": "text", "turnId": "turn-1", "text": "working"},
                {"_journal_event_id": "evt-2", "_journal_recorded_at_ns": 2, "type": "plan", "turnId": "turn-1",
                 "workspace": str(root), "items": [{"title": "Build", "status": "in_progress"}],
                 "acceptanceCriteria": ["The page renders without errors."],
                 "decisions": ["Use the existing router to preserve deep links."]},
                {"_journal_event_id": "evt-3", "_journal_recorded_at_ns": 3, "type": "tool_start", "turnId": "turn-1",
                 "workspace": str(root), "operationId": "op-1", "name": "write_file", "arguments": {"path": "index.html"}},
            ])
            self.assertTrue(appended["app_saved"])
            self.assertTrue(appended["project_saved"])

            recovered = store.load(state["session_id"], str(root))["state"]

            self.assertEqual(recovered["run_state"]["partial_content"], "working")
            self.assertEqual(recovered["plan"][0]["title"], "Build")
            self.assertEqual(recovered["activity_events"][0].get("acceptanceCriteria"), ["The page renders without errors."])
            self.assertEqual(recovered["task_checkpoint"]["current"]["acceptance_criteria"], ["The page renders without errors."])
            self.assertEqual(recovered["task_checkpoint"]["current"]["next_action"], "Build")
            self.assertEqual(recovered["task_checkpoint"]["current"]["decisions"][0]["text"], "Use the existing router to preserve deep links.")
            self.assertEqual(recovered["run_state"]["active_operation"]["operationId"], "op-1")
            self.assertTrue(any(row.get("operationId") == "op-1" for row in recovered["activity_events"]))

            recovered["journal_cursor_ns"] = appended["cursor_ns"]
            store.save(recovered)
            reopened = store.load(state["session_id"], str(root))["state"]
            self.assertEqual(reopened["run_state"]["partial_content"], "working")
            self.assertEqual(sum(row.get("operationId") == "op-1" for row in reopened["activity_events"]), 1)

    def test_final_response_replay_keeps_user_prompt_and_completed_tool_results(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "project"
            root.mkdir()
            store = MirroredSessionStore(Path(temp) / "app")
            state = store.create(str(root), "model", 65536)
            state["task_checkpoint"] = {"current": {"task_id": "task-2", "operations": [], "changed_files": [], "plan": []}}
            state["run_state"] = {
                "status": "running", "turn_id": "turn-2", "prompt": "Build the page",
                "safe_messages": [*state["messages"], {"role": "user", "content": "Build the page"}],
                "safe_prompt_included": True, "partial_content": "", "partial_thinking": "",
                "active_operation": None,
            }
            store.save(state)
            assistant_call = {"role": "assistant", "tool_calls": [{"id": "call-1", "function": {
                "name": "write_file", "arguments": {"path": "index.html", "content": "page"}}}]}
            store.append_events(state["session_id"], str(root), [
                {"_journal_event_id": "batch", "_journal_recorded_at_ns": 1, "type": "tool_batch",
                 "assistantMessage": assistant_call, "calls": [{"id": "call-1", "name": "write_file"}]},
                {"_journal_event_id": "start", "_journal_recorded_at_ns": 2, "type": "tool_start",
                 "operationId": "op-2", "toolCallId": "call-1", "name": "write_file", "arguments": {"path": "index.html"}},
                {"_journal_event_id": "done", "_journal_recorded_at_ns": 3, "type": "tool_done",
                 "operationId": "op-2", "toolCallId": "call-1", "name": "write_file",
                 "result": "Wrote index.html", "status": "completed", "affectedFiles": ["index.html"]},
                {"_journal_event_id": "next-request", "_journal_recorded_at_ns": 4, "type": "phase", "phase": "waiting"},
                {"_journal_event_id": "final-text", "_journal_recorded_at_ns": 5, "type": "text", "text": "Page is ready."},
                {"_journal_event_id": "prompt", "_journal_recorded_at_ns": 6, "activityId": "task-request-1", "type": "prompt_manifest",
                 "request_index": 1, "configured_context": 65536, "input_budget": 57344,
                 "estimated_request_input_tokens": 4096, "message_count": 3,
                 "messages": [{"index": 0, "role": "system", "source": "system_guidance_and_project_instructions", "characters": 800, "estimated_tokens": 400}],
                 "project_instruction_sources": [{"path": "AGENTS.md", "characters": 20, "estimated_tokens": 10}], "retrieved_project_files": ["index.html"],
                 "checkpoint_included": True, "compaction_notice_count": 0,
                 "skills": {"enabled": True, "selected_sources": ["project"], "available": [], "catalog_entries_in_request_tool_schema": [], "load_references_in_request_history": []},
                 "tools": [{"name": "read_file", "provider": "workbench"}],
                 "workflow": {"harness_profile": "standard", "task_intent": "implement", "effective_access": "ask"}},
                {"_journal_event_id": "complete", "_journal_recorded_at_ns": 7, "type": "generation_complete",
                 "verification": {"status": "not_verified", "steps": [], "contract": {
                     "implementation_requested": True, "project_change": "observed",
                     "post_change_inspection": "missing", "approved_command_results": [],
                     "command_success_is_test_pass": False}}, "workflowOutcome": "changed"},
            ])

            recovered = store.load(state["session_id"], str(root))["state"]
            messages = recovered["messages"]

            self.assertEqual(recovered["run_state"]["status"], "completed")
            self.assertEqual(recovered["run_state"]["workflow_outcome"], "changed")
            self.assertEqual(recovered["run_state"]["verification"]["contract"]["post_change_inspection"], "missing")
            prompt_rows = [row for row in recovered["activity_events"] if row.get("kind") == "prompt"]
            self.assertEqual(len(prompt_rows), 1)
            self.assertEqual(prompt_rows[0]["id"], "task-request-1")
            self.assertEqual(prompt_rows[0]["promptManifest"]["retrieved_project_files"], ["index.html"])
            self.assertEqual(messages[1]["content"], "Build the page")
            self.assertEqual(messages[3]["content"], "Wrote index.html")
            self.assertEqual(messages[-1]["content"], "Page is ready.")
            self.assertEqual(recovered["task_checkpoint"]["current"]["operations"][0]["result_ref"], "op-2")
            self.assertEqual(recovered["task_checkpoint"]["current"]["verification"]["contract"]["command_success_is_test_pass"], False)

    def test_app_snapshot_save_reports_app_failure_without_skipping_project_mirror(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "project"
            root.mkdir()
            store = MirroredSessionStore(Path(temp) / "app")
            state = store.create(str(root), "model", 8192)
            original = store.app.save
            store.app.save = lambda _: (_ for _ in ()).throw(PermissionError("locked"))

            result = store.save(state)

            self.assertFalse(result["app_saved"])
            self.assertTrue(result["project_saved"])
            self.assertIn("locked", result["error"])
            store.app.save = original

    def test_event_journal_retries_only_the_missing_mirror(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "project"
            store = MirroredSessionStore(Path(temp) / "app")
            event = {"_journal_event_id": "stable-event", "_journal_recorded_at_ns": 10,
                     "type": "text", "turnId": "turn-1", "text": "saved once"}
            first = store.append_events("session-1", str(root), [event])
            self.assertTrue(first["app_saved"])
            self.assertFalse(first["project_saved"])
            root.mkdir()

            retry = store.append_events("session-1", str(root), [{**event, "_journal_saved_to": ["app"]}])

            self.assertTrue(retry["app_saved"])
            self.assertTrue(retry["project_saved"])
            app_lines = (Path(temp) / "app" / "sessions" / "session-1.events.jsonl").read_text(encoding="utf-8").splitlines()
            project_lines = (root / ".agent-workbench" / "sessions" / "session-1.events.jsonl").read_text(encoding="utf-8").splitlines()
            self.assertEqual(len(app_lines), 1)
            self.assertEqual(len(project_lines), 1)

    def test_corrupt_journal_records_are_reported_and_raw_data_is_preserved(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "project"
            root.mkdir()
            store = MirroredSessionStore(Path(temp) / "app")
            state = store.create(str(root), "model", 8192)
            state["run_state"] = {"status": "running", "turn_id": "turn-corrupt", "safe_messages": [],
                                  "partial_content": "", "partial_thinking": ""}
            store.save(state)
            journal = Path(temp) / "app" / "sessions" / f"{state['session_id']}.events.jsonl"
            journal.write_text('{"event_id":"ok","recorded_at_ns":1,"event":{"type":"text","text":"kept"}}\n{truncated', encoding="utf-8")

            loaded = store.load(state["session_id"], str(root))["state"]

            self.assertEqual(loaded["run_state"]["partial_content"], "kept")
            self.assertTrue(any("line 2" in issue for issue in loaded["recovery_issues"]))
            self.assertIn("{truncated", journal.read_text(encoding="utf-8"))

    def test_failed_generation_keeps_text_received_before_provider_error(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "project"
            root.mkdir()
            store = MirroredSessionStore(Path(temp) / "app")
            state = store.create(str(root), "model", 8192)
            state["messages"].append({"role": "user", "content": "Write a page"})
            state["task_checkpoint"] = {"current": {"goal": "Write a page", "status": "active", "blockers": []}}
            state["run_state"] = {"status": "running", "turn_id": "turn-error", "safe_messages": state["messages"],
                                  "partial_content": "A partial answer", "partial_thinking": "Need continue"}
            store.save(state)
            store.append_events(state["session_id"], str(root), [
                {"_journal_event_id": "partial", "_journal_recorded_at_ns": 10, "type": "text", "turnId": "turn-error", "text": "A partial answer"},
                {"_journal_event_id": "failed", "_journal_recorded_at_ns": 20, "type": "error", "turnId": "turn-error", "error": "connection lost", "workflowOutcome": "response_missing"},
            ])

            recovered = store.load(state["session_id"], str(root))["state"]

            self.assertEqual(recovered["run_state"]["status"], "failed")
            self.assertEqual(recovered["messages"][-1]["content"], "A partial answer")
            self.assertEqual(recovered["messages"][-1]["thinking"], "Need continue")
            self.assertEqual(recovered["last_error"]["message"], "connection lost")
            self.assertEqual(recovered["task_checkpoint"]["current"]["status"], "failed")
            self.assertIn("connection lost", recovered["task_checkpoint"]["current"]["blockers"])
            self.assertEqual(recovered["run_state"]["workflow_outcome"], "response_missing")
            self.assertEqual(recovered["task_checkpoint"]["current"]["workflow_outcome"], "response_missing")

    def test_waiting_for_followup_model_call_checkpoints_prior_assistant_text(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "project"
            root.mkdir()
            store = MirroredSessionStore(Path(temp) / "app")
            state = store.create(str(root), "model", 8192)
            state["run_state"] = {"status": "running", "turn_id": "turn-followup", "prompt": "Build it",
                                  "safe_messages": [{"role": "user", "content": "Build it"}],
                                  "safe_prompt_included": True, "partial_content": "The plan is ready.",
                                  "partial_thinking": "I inspected the project."}
            store.save(state)
            store.append_events(state["session_id"], str(root), [
                {"_journal_event_id": "next-wait", "_journal_recorded_at_ns": 1,
                 "type": "phase", "phase": "waiting"},
            ])

            recovered = store.load(state["session_id"], str(root))["state"]

            assistant_rows = [row for row in recovered["run_state"]["safe_messages"] if row.get("role") == "assistant"]
            self.assertEqual(assistant_rows, [{"role": "assistant", "content": "The plan is ready.", "thinking": "I inspected the project."}])
            self.assertEqual(recovered["run_state"]["partial_content"], "")

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
