import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'node:child_process';
import { parseAdoRemote } from './remote.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

const mockExecSync = vi.mocked(execSync);

describe('parseAdoRemote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extracts org and project from HTTPS dev.azure.com remote', () => {
    mockExecSync.mockReturnValue(
      'origin\thttps://dev.azure.com/contoso/WebApp/_git/frontend (fetch)\n',
    );
    expect(parseAdoRemote('/tmp')).toEqual({
      org: 'contoso',
      project: 'WebApp',
    });
  });

  it('extracts org and project from SSH remote', () => {
    mockExecSync.mockReturnValue(
      'origin\tgit@ssh.dev.azure.com:v3/contoso/WebApp/frontend (fetch)\n',
    );
    expect(parseAdoRemote('/tmp')).toEqual({
      org: 'contoso',
      project: 'WebApp',
    });
  });

  it('extracts org and project from legacy visualstudio.com remote', () => {
    mockExecSync.mockReturnValue(
      'origin\thttps://contoso.visualstudio.com/WebApp/_git/frontend (fetch)\n',
    );
    expect(parseAdoRemote('/tmp')).toEqual({
      org: 'contoso',
      project: 'WebApp',
    });
  });

  it('URL-decodes project names with spaces', () => {
    mockExecSync.mockReturnValue(
      'origin\thttps://dev.azure.com/contoso/My%20Web%20App/_git/frontend (fetch)\n',
    );
    expect(parseAdoRemote('/tmp')).toEqual({
      org: 'contoso',
      project: 'My Web App',
    });
  });

  it('URL-decodes project names in legacy format', () => {
    mockExecSync.mockReturnValue(
      'origin\thttps://contoso.visualstudio.com/My%20Project/_git/repo (fetch)\n',
    );
    expect(parseAdoRemote('/tmp')).toEqual({
      org: 'contoso',
      project: 'My Project',
    });
  });

  it('handles SSH with spaces in project name', () => {
    mockExecSync.mockReturnValue(
      'origin\tgit@ssh.dev.azure.com:v3/contoso/My Web App/frontend (fetch)\n',
    );
    expect(parseAdoRemote('/tmp')).toEqual({
      org: 'contoso',
      project: 'My Web App',
    });
  });

  it('throws when no ADO remote found', () => {
    mockExecSync.mockReturnValue(
      'origin\tgit@github.com:user/repo.git (fetch)\n',
    );
    expect(() => parseAdoRemote('/tmp')).toThrow(
      'No Azure DevOps remote found',
    );
  });

  it('throws when git command fails', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('not a git repository');
    });
    expect(() => parseAdoRemote('/tmp')).toThrow();
  });
});
