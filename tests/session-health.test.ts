import { describe, expect, it } from 'vitest';
import { describeSessionHealth } from '../src/shared/session-health';

describe('describeSessionHealth', () => {
  it('prioritizes unresolved writes and divergent mirrors over the run status', () => {
    expect(describeSessionHealth({ sync_conflict: true, uncertain_operation: 'write_file', recovery_status: 'failed' }))
      .toEqual({ label: 'SYNC CONFLICT · choose copy', warning: true });
    expect(describeSessionHealth({ uncertain_operation: 'write_file', recovery_status: 'failed' }))
      .toEqual({ label: 'REVIEW PARTIAL OPERATION · write_file', warning: true });
  });

  it('makes recovery issues and unavailable projects visible before resume', () => {
    expect(describeSessionHealth({ recovery_issue_count: 2 }))
      .toEqual({ label: 'REVIEW RECOVERY · 2 issues', warning: true });
    expect(describeSessionHealth({}, false))
      .toEqual({ label: 'PROJECT UNAVAILABLE', warning: true });
  });

  it('marks interrupted outcomes for review while leaving ready sessions neutral', () => {
    expect(describeSessionHealth({ recovery_status: 'interrupted' }))
      .toEqual({ label: 'INTERRUPTED · RECOVERY REQUIRED', warning: true });
    expect(describeSessionHealth({ recovery_status: 'ready' }))
      .toEqual({ label: 'READY', warning: false });
  });
});
