import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execFile } from 'node:child_process';
import {
  checkBackendAvailability,
  checkAllBackendAvailability,
  BACKEND_CLI,
} from './availability.js';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

const mockExecFile = vi.mocked(execFile);

function simulateSuccess() {
  mockExecFile.mockImplementation((_bin, _args, _opts, callback) => {
    (callback as (error: Error | null) => void)(null);
    return { on: vi.fn() } as never;
  });
}

function simulateFailure() {
  mockExecFile.mockImplementation((_bin, _args, _opts, callback) => {
    (callback as (error: Error | null) => void)(new Error('not found'));
    return { on: vi.fn() } as never;
  });
}

describe('BACKEND_CLI', () => {
  it('maps none to null (no CLI needed)', () => {
    expect(BACKEND_CLI.none).toBeNull();
  });

  it('maps filesystem to null (no CLI needed)', () => {
    expect(BACKEND_CLI.filesystem).toBeNull();
  });

  it('maps github to gh', () => {
    expect(BACKEND_CLI.github).toBe('gh');
  });

  it('maps gitlab to null (no CLI needed)', () => {
    expect(BACKEND_CLI.gitlab).toBeNull();
  });

  it('maps azure to az', () => {
    expect(BACKEND_CLI.azure).toBe('az');
  });

  it('maps jira to null (no CLI needed)', () => {
    expect(BACKEND_CLI.jira).toBeNull();
  });
});

describe('checkBackendAvailability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true for none (no CLI required)', async () => {
    const result = await checkBackendAvailability('none');
    expect(result).toBe(true);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('returns true for filesystem (no CLI required)', async () => {
    const result = await checkBackendAvailability('filesystem');
    expect(result).toBe(true);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('returns true for jira (no CLI required)', async () => {
    const result = await checkBackendAvailability('jira');
    expect(result).toBe(true);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('returns true when gh CLI is available', async () => {
    simulateSuccess();
    const result = await checkBackendAvailability('github');
    expect(result).toBe(true);
    expect(mockExecFile).toHaveBeenCalledWith(
      'gh',
      ['--version'],
      { timeout: 5000 },
      expect.any(Function),
    );
  });

  it('returns false when gh CLI is not available', async () => {
    simulateFailure();
    const result = await checkBackendAvailability('github');
    expect(result).toBe(false);
  });

  it('returns true for gitlab (no CLI required)', async () => {
    const result = await checkBackendAvailability('gitlab');
    expect(result).toBe(true);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('returns true when az CLI is available', async () => {
    simulateSuccess();
    const result = await checkBackendAvailability('azure');
    expect(result).toBe(true);
    expect(mockExecFile).toHaveBeenCalledWith(
      'az',
      ['--version'],
      { timeout: 5000 },
      expect.any(Function),
    );
  });

  it('returns false when az CLI is not available', async () => {
    simulateFailure();
    const result = await checkBackendAvailability('azure');
    expect(result).toBe(false);
  });
});

describe('checkAllBackendAvailability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('checks all backends in parallel and returns results', async () => {
    simulateSuccess();
    const result = await checkAllBackendAvailability();
    expect(result).toEqual({
      none: true,
      filesystem: true,
      github: true,
      gitlab: true,
      azure: true,
      jira: true,
    });
    // Only CLI backends should trigger execFile (github, azure)
    expect(mockExecFile).toHaveBeenCalledTimes(2);
  });

  it('reports unavailable backends correctly', async () => {
    simulateFailure();
    const result = await checkAllBackendAvailability();
    expect(result).toEqual({
      none: true,
      filesystem: true,
      github: false,
      gitlab: true,
      azure: false,
      jira: true,
    });
  });
});
