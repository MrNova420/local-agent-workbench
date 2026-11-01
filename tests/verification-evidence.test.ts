import { describe, expect, it } from 'vitest';
import { readVerificationEvidence, verificationEvidenceLabel } from '../src/shared/verification-evidence';

describe('verification evidence restoration', () => {
  it('shows the persisted post-change inspection and command evidence', () => {
    const evidence = readVerificationEvidence({
      status: 'command_completed',
      contract: {
        implementation_requested: true,
        project_change: 'observed',
        post_change_inspection: 'missing',
        approved_command_results: ['completed'],
        command_success_is_test_pass: false,
      },
    });

    expect(verificationEvidenceLabel(evidence)).toBe(
      'project change observed · post-change inspection missing · approved command result: completed · command completion does not prove tests passed.',
    );
  });

  it('keeps older terminal records readable without inventing evidence', () => {
    expect(verificationEvidenceLabel(readVerificationEvidence({ status: 'inspected' }))).toBe('Verification evidence: inspected.');
    expect(readVerificationEvidence(null)).toBeNull();
  });
});
