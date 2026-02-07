import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { glabSync, glabExecSync, glab, glabExec } from './glab.js';

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

describe('glabSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses JSON output from glab command', () => {
    mockExecFileSync.mockReturnValue('{"iid": 1, "title": "Test"}');
    const result = glabSync<{ iid: number; title: string }>(
      ['issue', 'view', '1', '-F', 'json'],
      '/tmp',
    );
    expect(result).toEqual({ iid: 1, title: 'Test' });
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'glab',
      ['issue', 'view', '1', '-F', 'json'],
      { cwd: '/tmp', encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
  });

  it('throws on glab command failure', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('glab: command failed');
    });
    expect(() => glabSync(['issue', 'view', '999'], '/tmp')).toThrow();
  });
});

describe('glabExecSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns raw string output', () => {
    mockExecFileSync.mockReturnValue('Closed issue #1\n');
    const result = glabExecSync(['issue', 'close', '1'], '/tmp');
    expect(result).toBe('Closed issue #1\n');
  });
});

describe('glab (async)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses JSON output from glab command', async () => {
    mockExecFilePromisified.mockResolvedValueOnce({
      stdout: '{"iid": 1, "title": "Test"}',
      stderr: '',
    });

    const result = await glab<{ iid: number; title: string }>(
      ['issue', 'view', '1', '-F', 'json'],
      '/tmp',
    );
    expect(result).toEqual({ iid: 1, title: 'Test' });
  });

  it('returns empty array for non-JSON output', async () => {
    mockExecFilePromisified.mockResolvedValueOnce({
      stdout: 'some non-json text',
      stderr: '',
    });

    const result = await glab<unknown[]>(['issue', 'list'], '/tmp');
    expect(result).toEqual([]);
  });

  it('rejects on glab command failure', async () => {
    mockExecFilePromisified.mockRejectedValueOnce(
      new Error('glab: command failed'),
    );

    await expect(glab(['issue', 'view', '999'], '/tmp')).rejects.toThrow(
      'glab: command failed',
    );
  });
});

describe('glabExec (async)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns raw string output', async () => {
    mockExecFilePromisified.mockResolvedValueOnce({
      stdout: 'Closed issue #1\n',
      stderr: '',
    });

    const result = await glabExec(['issue', 'close', '1'], '/tmp');
    expect(result).toBe('Closed issue #1\n');
  });
});
