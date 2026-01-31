import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'node:child_process';
import { gh, ghExec } from './gh.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

const mockExecSync = vi.mocked(execSync);

describe('gh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses JSON output from gh command', () => {
    mockExecSync.mockReturnValue('{"number": 1, "title": "Test"}');
    const result = gh<{ number: number; title: string }>(
      ['issue', 'view', '1', '--json', 'number,title'],
      '/tmp',
    );
    expect(result).toEqual({ number: 1, title: 'Test' });
    expect(mockExecSync).toHaveBeenCalledWith(
      'gh issue view 1 --json number,title',
      { cwd: '/tmp', encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
  });

  it('throws on gh command failure', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('gh: command failed');
    });
    expect(() => gh(['issue', 'view', '999'], '/tmp')).toThrow();
  });
});

describe('ghExec', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns raw string output', () => {
    mockExecSync.mockReturnValue('Closed issue #1\n');
    const result = ghExec(['issue', 'close', '1'], '/tmp');
    expect(result).toBe('Closed issue #1\n');
  });
});
