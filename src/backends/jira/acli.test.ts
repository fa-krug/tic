import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { acliSync, acliExecSync, acli, acliExec } from './acli.js';

const { mockExecFilePromisified } = vi.hoisted(() => {
  const mockExecFilePromisified = vi
    .fn()
    .mockResolvedValue({ stdout: '', stderr: '' });
  return { mockExecFilePromisified };
});

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const mockExecFile = Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: mockExecFilePromisified,
  });
  return {
    ...actual,
    execFileSync: vi.fn(),
    execFile: mockExecFile,
  };
});

const mockExecFileSync = vi.mocked(execFileSync);

describe('acliSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses JSON output from acli command', () => {
    mockExecFileSync.mockReturnValue('{"key": "TEAM-1", "fields": {}}');
    const result = acliSync<{ key: string; fields: Record<string, unknown> }>(
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
      acliSync(['jira', 'workitem', 'view', 'TEAM-999'], '/tmp'),
    ).toThrow();
  });
});

describe('acliExecSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns raw string output', () => {
    mockExecFileSync.mockReturnValue('OK\n');
    const result = acliExecSync(['jira', 'auth', 'status'], '/tmp');
    expect(result).toBe('OK\n');
  });
});

describe('acli (async)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses JSON output from acli command', async () => {
    mockExecFilePromisified.mockResolvedValueOnce({
      stdout: '{"key": "TEAM-1", "fields": {}}',
      stderr: '',
    });

    const result = await acli<{ key: string; fields: Record<string, unknown> }>(
      ['jira', 'workitem', 'view', 'TEAM-1', '--json'],
      '/tmp',
    );
    expect(result).toEqual({ key: 'TEAM-1', fields: {} });
  });

  it('rejects on acli command failure', async () => {
    mockExecFilePromisified.mockRejectedValueOnce(
      new Error('acli: command failed'),
    );

    await expect(
      acli(['jira', 'workitem', 'view', 'TEAM-999'], '/tmp'),
    ).rejects.toThrow('acli: command failed');
  });
});

describe('acliExec (async)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns raw string output', async () => {
    mockExecFilePromisified.mockResolvedValueOnce({
      stdout: 'OK\n',
      stderr: '',
    });

    const result = await acliExec(['jira', 'auth', 'status'], '/tmp');
    expect(result).toBe('OK\n');
  });
});
