import { describe, expect, it } from 'vitest';
import { parsePermissionCommandPrefix } from '../src/shared/permission-rules';

describe('parsePermissionCommandPrefix', () => {
  it('requires wildcard command rules to use argv tokens for both command tools', () => {
    expect(parsePermissionCommandPrefix('*', '["python", "-m", "pytest"]')).toEqual(['python', '-m', 'pytest']);
    expect(() => parsePermissionCommandPrefix('*', 'python -m pytest')).toThrow(/Wildcard command rules need a JSON array/);
  });

  it('preserves the command-specific input formats', () => {
    expect(parsePermissionCommandPrefix('run_command', '["python", "-m", "pytest"]')).toEqual(['python', '-m', 'pytest']);
    expect(parsePermissionCommandPrefix('run_shell', 'python -m pytest')).toBe('python -m pytest');
  });
});
