import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { glab, glabExec } from './glab.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

const mockExecFileSync = vi.mocked(execFileSync);

describe('glab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses JSON output from glab command', () => {
    mockExecFileSync.mockReturnValue('{"iid": 1, "title": "Test"}');
    const result = glab<{ iid: number; title: string }>(
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
    expect(() => glab(['issue', 'view', '999'], '/tmp')).toThrow();
  });
});

describe('glabExec', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns raw string output', () => {
    mockExecFileSync.mockReturnValue('Closed issue #1\n');
    const result = glabExec(['issue', 'close', '1'], '/tmp');
    expect(result).toBe('Closed issue #1\n');
  });
});
