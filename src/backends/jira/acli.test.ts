import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { acli, acliExec } from './acli.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

const mockExecFileSync = vi.mocked(execFileSync);

describe('acli', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses JSON output from acli command', () => {
    mockExecFileSync.mockReturnValue('{"key": "TEAM-1", "fields": {}}');
    const result = acli<{ key: string; fields: Record<string, unknown> }>(
      ['jira', 'workitem', 'view', 'TEAM-1', '--json'],
      '/tmp',
    );
    expect(result).toEqual({ key: 'TEAM-1', fields: {} });
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'acli',
      ['jira', 'workitem', 'view', 'TEAM-1', '--json'],
      { cwd: '/tmp', encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
  });

  it('throws on acli command failure', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('acli: command failed');
    });
    expect(() =>
      acli(['jira', 'workitem', 'view', 'TEAM-999'], '/tmp'),
    ).toThrow();
  });
});

describe('acliExec', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns raw string output', () => {
    mockExecFileSync.mockReturnValue('OK\n');
    const result = acliExec(['jira', 'auth', 'status'], '/tmp');
    expect(result).toBe('OK\n');
  });
});
