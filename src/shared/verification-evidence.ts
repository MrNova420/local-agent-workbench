export type VerificationEvidence = {
  status?: string;
  contract?: {
    implementation_requested?: boolean;
    project_change?: string;
    post_change_inspection?: string;
    approved_command_results?: unknown[];
    command_success_is_test_pass?: boolean;
  };
};

export function readVerificationEvidence(value: unknown): VerificationEvidence | null {
  if (!value || typeof value !== 'object') return null;
  const report = value as Record<string, unknown>;
  const raw = report.contract && typeof report.contract === 'object' ? report.contract as Record<string, unknown> : {};
  return {
    status: typeof report.status === 'string' ? report.status : undefined,
    contract: {
      implementation_requested: typeof raw.implementation_requested === 'boolean' ? raw.implementation_requested : undefined,
      project_change: typeof raw.project_change === 'string' ? raw.project_change : undefined,
      post_change_inspection: typeof raw.post_change_inspection === 'string' ? raw.post_change_inspection : undefined,
      approved_command_results: Array.isArray(raw.approved_command_results) ? raw.approved_command_results : undefined,
      command_success_is_test_pass: typeof raw.command_success_is_test_pass === 'boolean' ? raw.command_success_is_test_pass : undefined,
    },
  };
}

export function verificationEvidenceLabel(value: VerificationEvidence | null): string | null {
  const contract = value?.contract;
  if (!contract) return value?.status ? `Verification evidence: ${value.status.replaceAll('_', ' ')}.` : null;
  const parts: string[] = [];
  if (contract.project_change && contract.project_change !== 'not_required') parts.push(`project change ${contract.project_change.replaceAll('_', ' ')}`);
  if (contract.post_change_inspection && contract.post_change_inspection !== 'not_applicable') parts.push(`post-change inspection ${contract.post_change_inspection}`);
  const commands = contract.approved_command_results ?? [];
  if (commands.length) parts.push(`approved command result${commands.length === 1 ? '' : 's'}: ${commands.map((item) => String(item).replaceAll('_', ' ')).join(', ')}`);
  if (commands.includes('completed') && contract.command_success_is_test_pass === false) parts.push('command completion does not prove tests passed');
  return parts.length ? parts.join(' · ') + '.' : value?.status ? `Verification evidence: ${value.status.replaceAll('_', ' ')}.` : null;
}
