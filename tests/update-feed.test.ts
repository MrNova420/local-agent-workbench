import { describe, expect, it } from 'vitest';
import { publicWindowsUpdateFeed } from '../src/shared/update-feed';
import { readFileSync } from 'node:fs';

describe('public release update feed', () => {
  it('uses the installed Windows x64 build version in the Electron public update service URL', () => {
    expect(publicWindowsUpdateFeed('0.1.0-beta.2', 'win32', 'x64', true))
      .toBe('https://update.electronjs.org/MrNova420/local-agent-workbench/win32-x64/0.1.0-beta.2');
  });

  it('does not advertise updates on platforms without a packaged updater', () => {
    expect(publicWindowsUpdateFeed('0.1.0-beta.2', 'linux', 'x64', true)).toBeNull();
    expect(publicWindowsUpdateFeed('0.1.0-beta.2', 'win32', 'arm64', true)).toBeNull();
    expect(publicWindowsUpdateFeed('0.1.0-beta.2', 'win32', 'x64', false)).toBeNull();
  });

  it('publishes beta SemVer tags as normal GitHub releases so the public updater can discover them', () => {
    const workflow = readFileSync(new URL('../.github/workflows/release-windows.yml', import.meta.url), 'utf8');
    expect(workflow).toContain('prerelease: false');
    expect(workflow).toContain('The Electron public update service ignores GitHub-marked prereleases');
  });
});
