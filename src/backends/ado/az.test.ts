import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { az, azExec, azInvoke } from './az.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

const mockExecFileSync = vi.mocked(execFileSync);

describe('az', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses JSON output from az command', () => {
    mockExecFileSync.mockReturnValue('[{"id": 1, "fields": {}}]');
    const result = az<{ id: number }[]>(
      ['boards', 'work-item', 'show', '--id', '1'],
      '/tmp',
    );
    expect(result).toEqual([{ id: 1, fields: {} }]);
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'az',
      ['boards', 'work-item', 'show', '--id', '1', '-o', 'json'],
      { cwd: '/tmp', encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
  });

  it('throws on az command failure', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('az: command failed');
    });
    expect(() => az(['boards', 'query'], '/tmp')).toThrow();
  });
});

describe('azExec', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns raw string output', () => {
    mockExecFileSync.mockReturnValue('Deleted work item 42\n');
    const result = azExec(
      ['boards', 'work-item', 'delete', '--id', '42', '--yes'],
      '/tmp',
    );
    expect(result).toBe('Deleted work item 42\n');
  });
});

describe('azInvoke', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls az devops invoke with correct args and parses JSON', () => {
    mockExecFileSync.mockReturnValue('{"count": 2, "value": []}');
    const result = azInvoke<{ count: number }>(
      {
        area: 'wit',
        resource: 'workitemsbatch',
        httpMethod: 'POST',
        body: { ids: [1, 2] },
      },
      '/tmp',
    );
    expect(result).toEqual({ count: 2, value: [] });
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'az',
      expect.arrayContaining([
        'devops',
        'invoke',
        '--area',
        'wit',
        '--resource',
        'workitemsbatch',
        '--http-method',
        'POST',
      ]),
      expect.objectContaining({ cwd: '/tmp' }),
    );
  });

  it('passes route parameters when provided', () => {
    mockExecFileSync.mockReturnValue('{"comments": []}');
    azInvoke<unknown>(
      {
        area: 'wit',
        resource: 'comments',
        routeParameters: 'workItemId=42',
      },
      '/tmp',
    );
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'az',
      expect.arrayContaining(['--route-parameters', 'workItemId=42']),
      expect.anything(),
    );
  });
});
