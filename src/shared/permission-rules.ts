export type PermissionCommandTool = '*' | 'run_command' | 'run_shell';

export function parsePermissionCommandPrefix(tool: PermissionCommandTool, value: string): string | string[] {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`Rule ${tool} needs a command prefix.`);
  if (tool === 'run_command' || tool === '*') {
    let prefix: unknown;
    try { prefix = JSON.parse(trimmed); }
    catch { throw new Error(`${tool === '*' ? 'Wildcard command rules' : 'run_command rules'} need a JSON array of argv tokens, such as ["python", "-m", "pytest"].`); }
    if (!Array.isArray(prefix) || !prefix.length || prefix.some((token) => typeof token !== 'string' || !token)) {
      throw new Error(`${tool === '*' ? 'Wildcard command rules' : 'run_command rules'} need a JSON array of non-empty argv tokens, such as ["python", "-m", "pytest"].`);
    }
    return prefix as string[];
  }
  return trimmed;
}
