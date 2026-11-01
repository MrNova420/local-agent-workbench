export function publicWindowsUpdateFeed(version: string, platform: string, architecture: string, squirrelInstalled: boolean): string | null {
  if (!squirrelInstalled || platform !== 'win32' || architecture !== 'x64') return null;
  return `https://update.electronjs.org/MrNova420/local-agent-workbench/win32-x64/${encodeURIComponent(version)}`;
}
