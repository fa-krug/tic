import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFileSync, execFile } from 'node:child_process';
import {
  az,
  azExec,
  azInvoke,
  azSync,
  azExecSync,
  azInvokeSync,
} from './az.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
  execFile: vi.fn(),
}));

vi.mock('node:util', () => ({
  promisify: vi.fn((fn: unknown) => fn),
}));

const mockExecFileSync = vi.mocked(execFileSync);
const mockExecFile = vi.mocked(execFile) as unknown as ReturnType<
  typeof vi.fn<(...args: unknown[]) => { stdout: string; stderr: string }>
>;

describe('az (async)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses JSON output from az command', async () => {
    mockExecFile.mockResolvedValue({
      stdout: '[{"id": 1, "fields": {}}]',
      stderr: '',
    });
    const result = await az<{ id: number }[]>(
      ['boards', 'work-item', 'show', '--id', '1'],
      '/tmp',
    );
    expect(result).toEqual([{ id: 1, fields: {} }]);
    expect(mockExecFile).toHaveBeenCalledWith(
      'az',
      ['boards', 'work-item', 'show', '--id', '1', '-o', 'json'],
      {
        cwd: '/tmp',
        encoding: 'utf-8',
        timeout: 15_000,
        maxBuffer: 10 * 1024 * 1024,
      },
    );
  });

  it('throws on az command failure', async () => {
    mockExecFile.mockRejectedValue(new Error('az: command failed'));
    await expect(az(['boards', 'query'], '/tmp')).rejects.toThrow();
  });
});

describe('azExec (async)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns raw string output', async () => {
    mockExecFile.mockResolvedValue({
      stdout: 'Deleted work item 42\n',
      stderr: '',
    });
    const result = await azExec(
      ['boards', 'work-item', 'delete', '--id', '42', '--yes'],
      '/tmp',
    );
    expect(result).toBe('Deleted work item 42\n');
  });
});

describe('azInvoke (async)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls az devops invoke with correct args and parses JSON', async () => {
    mockExecFile.mockResolvedValue({
      stdout: '{"count": 2, "value": []}',
      stderr: '',
    });
    const result = await azInvoke<{ count: number }>(
      {
        area: 'wit',
        resource: 'workitemsbatch',
        httpMethod: 'POST',
        body: { ids: [1, 2] },
      },
      '/tmp',
    );
    expect(result).toEqual({ count: 2, value: [] });
    expect(mockExecFile).toHaveBeenCalledWith(
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

  it('passes route parameters when provided', async () => {
    mockExecFile.mockResolvedValue({
      stdout: '{"comments": []}',
      stderr: '',
    });
    await azInvoke<unknown>(
      {
        area: 'wit',
        resource: 'comments',
        routeParameters: 'workItemId=42',
      },
      '/tmp',
    );
    expect(mockExecFile).toHaveBeenCalledWith(
      'az',
      expect.arrayContaining(['--route-parameters', 'workItemId=42']),
      expect.anything(),
    );
  });
});

describe('azSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses JSON output from sync az command', () => {
    mockExecFileSync.mockReturnValue('[{"id": 1}]');
    const result = azSync<{ id: number }[]>(['account', 'show'], '/tmp');
    expect(result).toEqual([{ id: 1 }]);
  });
});

describe('azExecSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns raw string output', () => {
    mockExecFileSync.mockReturnValue('ok\n');
    const result = azExecSync(['account', 'show'], '/tmp');
    expect(result).toBe('ok\n');
  });
});

describe('azInvokeSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls az devops invoke sync and parses JSON', () => {
    mockExecFileSync.mockReturnValue('{"value": []}');
    const result = azInvokeSync<{ value: unknown[] }>(
      {
        area: 'wit',
        resource: 'workitemtypes',
        routeParameters: 'project=MyProject',
        apiVersion: '7.1',
      },
      '/tmp',
    );
    expect(result).toEqual({ value: [] });
  });
});
