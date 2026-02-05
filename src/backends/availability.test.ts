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
  it('maps local to null (no CLI needed)', () => {
    expect(BACKEND_CLI.local).toBeNull();
  });

  it('maps github to gh', () => {
    expect(BACKEND_CLI.github).toBe('gh');
  });

  it('maps gitlab to glab', () => {
    expect(BACKEND_CLI.gitlab).toBe('glab');
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

  it('returns true for local (no CLI required)', async () => {
    const result = await checkBackendAvailability('local');
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

  it('returns true when glab CLI is available', async () => {
    simulateSuccess();
    const result = await checkBackendAvailability('gitlab');
    expect(result).toBe(true);
    expect(mockExecFile).toHaveBeenCalledWith(
      'glab',
      ['--version'],
      { timeout: 5000 },
      expect.any(Function),
    );
  });

  it('returns false when glab CLI is not available', async () => {
    simulateFailure();
    const result = await checkBackendAvailability('gitlab');
    expect(result).toBe(false);
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
      local: true,
      github: true,
      gitlab: true,
      azure: true,
      jira: true,
    });
    // Only CLI backends should trigger execFile (github, gitlab, azure)
    expect(mockExecFile).toHaveBeenCalledTimes(3);
  });

  it('reports unavailable backends correctly', async () => {
    simulateFailure();
    const result = await checkAllBackendAvailability();
    expect(result).toEqual({
      local: true,
      github: false,
      gitlab: false,
      azure: false,
      jira: true,
    });
  });
});
