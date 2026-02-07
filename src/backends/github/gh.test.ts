import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { ghSync, ghExecSync, gh, ghExec } from './gh.js';

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

describe('ghSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses JSON output from gh command', () => {
    mockExecFileSync.mockReturnValue('{"number": 1, "title": "Test"}');
    const result = ghSync<{ number: number; title: string }>(
      ['issue', 'view', '1', '--json', 'number,title'],
      '/tmp',
    );
    expect(result).toEqual({ number: 1, title: 'Test' });
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'gh',
      ['issue', 'view', '1', '--json', 'number,title'],
      { cwd: '/tmp', encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
  });

  it('throws on gh command failure', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('gh: command failed');
    });
    expect(() => ghSync(['issue', 'view', '999'], '/tmp')).toThrow();
  });
});

describe('ghExecSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns raw string output', () => {
    mockExecFileSync.mockReturnValue('Closed issue #1\n');
    const result = ghExecSync(['issue', 'close', '1'], '/tmp');
    expect(result).toBe('Closed issue #1\n');
  });
});

describe('gh (async)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses JSON output from gh command', async () => {
    mockExecFilePromisified.mockResolvedValueOnce({
      stdout: '{"number": 1, "title": "Test"}',
      stderr: '',
    });

    const result = await gh<{ number: number; title: string }>(
      ['issue', 'view', '1', '--json', 'number,title'],
      '/tmp',
    );
    expect(result).toEqual({ number: 1, title: 'Test' });
  });

  it('rejects on gh command failure', async () => {
    mockExecFilePromisified.mockRejectedValueOnce(
      new Error('gh: command failed'),
    );

    await expect(gh(['issue', 'view', '999'], '/tmp')).rejects.toThrow(
      'gh: command failed',
    );
  });
});

describe('ghExec (async)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns raw string output', async () => {
    mockExecFilePromisified.mockResolvedValueOnce({
      stdout: 'Closed issue #1\n',
      stderr: '',
    });

    const result = await ghExec(['issue', 'close', '1'], '/tmp');
    expect(result).toBe('Closed issue #1\n');
  });
});
