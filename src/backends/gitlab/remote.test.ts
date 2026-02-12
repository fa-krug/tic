import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'node:child_process';
import { parseGitLabRemote } from './remote.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

const mockExecSync = vi.mocked(execSync);

describe('parseGitLabRemote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses SSH remote', () => {
    mockExecSync.mockReturnValue(
      'origin\tgit@gitlab.com:mygroup/myproject.git (fetch)\n' +
        'origin\tgit@gitlab.com:mygroup/myproject.git (push)\n',
    );
    expect(parseGitLabRemote('/tmp')).toEqual({
      host: 'gitlab.com',
      group: 'mygroup',
      project: 'myproject',
      fullPath: 'mygroup/myproject',
    });
  });

  it('parses HTTPS remote', () => {
    mockExecSync.mockReturnValue(
      'origin\thttps://gitlab.com/mygroup/myproject.git (fetch)\n',
    );
    expect(parseGitLabRemote('/tmp')).toEqual({
      host: 'gitlab.com',
      group: 'mygroup',
      project: 'myproject',
      fullPath: 'mygroup/myproject',
    });
  });

  it('supports nested subgroups via SSH', () => {
    mockExecSync.mockReturnValue(
      'origin\tgit@gitlab.com:org/team/subteam/project.git (fetch)\n',
    );
    expect(parseGitLabRemote('/tmp')).toEqual({
      host: 'gitlab.com',
      group: 'org/team/subteam',
      project: 'project',
      fullPath: 'org/team/subteam/project',
    });
  });

  it('supports nested subgroups via HTTPS', () => {
    mockExecSync.mockReturnValue(
      'origin\thttps://gitlab.com/org/team/subteam/project.git (fetch)\n',
    );
    expect(parseGitLabRemote('/tmp')).toEqual({
      host: 'gitlab.com',
      group: 'org/team/subteam',
      project: 'project',
      fullPath: 'org/team/subteam/project',
    });
  });

  it('supports self-hosted GitLab instances', () => {
    mockExecSync.mockReturnValue(
      'origin\tgit@gitlab.example.com:mygroup/myproject.git (fetch)\n',
    );
    expect(parseGitLabRemote('/tmp')).toEqual({
      host: 'gitlab.example.com',
      group: 'mygroup',
      project: 'myproject',
      fullPath: 'mygroup/myproject',
    });
  });

  it('throws when no GitLab remote found', () => {
    mockExecSync.mockReturnValue(
      'origin\tgit@github.com:user/repo.git (fetch)\n',
    );
    expect(() => parseGitLabRemote('/tmp')).toThrow('No GitLab remote found');
  });

  it('throws on invalid path with single segment', () => {
    mockExecSync.mockReturnValue(
      'origin\tgit@gitlab.com:project.git (fetch)\n',
    );
    expect(() => parseGitLabRemote('/tmp')).toThrow(
      'Invalid GitLab remote path',
    );
  });

  it('throws when git command fails', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('not a git repository');
    });
    expect(() => parseGitLabRemote('/tmp')).toThrow();
  });
});
