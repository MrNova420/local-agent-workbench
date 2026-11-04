export type SessionHealthInput = {
  sync_conflict?: boolean;
  recommended_source?: 'app' | 'project';
  uncertain_operation?: string | null;
  recovery_issue_count?: number;
  recovery_status?: string | null;
};

export function describeSessionHealth(row: SessionHealthInput, workspaceAvailable = true): { label: string; warning: boolean } {
  if (row.sync_conflict) return { label: `SYNC CONFLICT · ${row.recommended_source || 'choose copy'}`, warning: true };
  if (row.uncertain_operation) return { label: `REVIEW PARTIAL OPERATION · ${row.uncertain_operation}`, warning: true };
  const issues = Number.isFinite(row.recovery_issue_count) ? Math.max(0, Math.trunc(row.recovery_issue_count || 0)) : 0;
  if (issues) return { label: `REVIEW RECOVERY · ${issues} ${issues === 1 ? 'issue' : 'issues'}`, warning: true };
  if (!workspaceAvailable) return { label: 'PROJECT UNAVAILABLE', warning: true };
  const status = String(row.recovery_status || 'ready').toLowerCase();
  if (['interrupted', 'failed', 'cancelled', 'stopped'].includes(status)) {
    return { label: `${status.toUpperCase()} · RECOVERY REQUIRED`, warning: true };
  }
  return { label: status.toUpperCase(), warning: false };
}
