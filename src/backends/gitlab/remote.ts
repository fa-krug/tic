import { execSync } from 'node:child_process';

export interface GitLabRemoteInfo {
  host: string; // e.g. 'gitlab.com'
  group: string; // e.g. 'mygroup' or 'mygroup/subgroup'
  project: string; // e.g. 'myproject'
  fullPath: string; // e.g. 'mygroup/myproject'
}

export function parseGitLabRemote(cwd: string): GitLabRemoteInfo {
  const output = execSync('git remote -v', {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const lines = output.split('\n');
  for (const line of lines) {
    // SSH: git@gitlab.com:group/subgroup/project.git
    const sshMatch = line.match(/git@([^:]+):(.+?)\.git/);
    if (sshMatch && sshMatch[1]!.includes('gitlab')) {
      return parseRemotePath(sshMatch[1]!, sshMatch[2]!);
    }

    // HTTPS: https://gitlab.com/group/subgroup/project.git
    const httpsMatch = line.match(/https?:\/\/([^/]+)\/(.+?)\.git/);
    if (httpsMatch && httpsMatch[1]!.includes('gitlab')) {
      return parseRemotePath(httpsMatch[1]!, httpsMatch[2]!);
    }
  }

  throw new Error('No GitLab remote found in git remotes');
}

function parseRemotePath(host: string, fullPath: string): GitLabRemoteInfo {
  const segments = fullPath.split('/');
  if (segments.length < 2) {
    throw new Error(
      `Invalid GitLab remote path: ${fullPath} (expected group/project)`,
    );
  }

  const project = segments[segments.length - 1]!;
  const group = segments.slice(0, -1).join('/');

  return { host, group, project, fullPath };
}
