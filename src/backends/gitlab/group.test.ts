import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'node:child_process';
import { detectGroup } from './group.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

const mockExecSync = vi.mocked(execSync);

describe('detectGroup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts group from SSH remote', () => {
    mockExecSync.mockReturnValue(
      'origin\tgit@gitlab.com:mygroup/project.git (fetch)\n' +
        'origin\tgit@gitlab.com:mygroup/project.git (push)\n',
    );
    expect(detectGroup('/tmp')).toBe('mygroup');
  });

  it('extracts group from HTTPS remote', () => {
    mockExecSync.mockReturnValue(
      'origin\thttps://gitlab.com/mygroup/project.git (fetch)\n',
    );
    expect(detectGroup('/tmp')).toBe('mygroup');
  });

  it('supports nested subgroups via SSH', () => {
    mockExecSync.mockReturnValue(
      'origin\tgit@gitlab.com:a/b/c/project.git (fetch)\n',
    );
    expect(detectGroup('/tmp')).toBe('a/b/c');
  });

  it('supports nested subgroups via HTTPS', () => {
    mockExecSync.mockReturnValue(
      'origin\thttps://gitlab.com/a/b/c/project.git (fetch)\n',
    );
    expect(detectGroup('/tmp')).toBe('a/b/c');
  });

  it('throws when no GitLab remote found', () => {
    mockExecSync.mockReturnValue(
      'origin\tgit@github.com:user/repo.git (fetch)\n',
    );
    expect(() => detectGroup('/tmp')).toThrow('No GitLab remote found');
  });

  it('throws when git command fails', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('not a git repository');
    });
    expect(() => detectGroup('/tmp')).toThrow();
  });
});
