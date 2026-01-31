import { execSync } from 'node:child_process';

export function detectGroup(cwd: string): string {
  const output = execSync('git remote -v', {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const lines = output.split('\n');
  for (const line of lines) {
    // SSH: git@gitlab.com:group/subgroup/project.git
    const sshMatch = line.match(/gitlab\.com:(.+?)\.git/);
    if (sshMatch) {
      const fullPath = sshMatch[1]!;
      const segments = fullPath.split('/');
      if (segments.length < 2) {
        throw new Error(
          `Invalid GitLab remote path: ${fullPath} (expected group/project)`,
        );
      }
      return segments.slice(0, -1).join('/');
    }

    // HTTPS: https://gitlab.com/group/subgroup/project.git
    const httpsMatch = line.match(/gitlab\.com\/(.+?)\.git/);
    if (httpsMatch) {
      const fullPath = httpsMatch[1]!;
      const segments = fullPath.split('/');
      if (segments.length < 2) {
        throw new Error(
          `Invalid GitLab remote path: ${fullPath} (expected group/project)`,
        );
      }
      return segments.slice(0, -1).join('/');
    }
  }

  throw new Error('No GitLab remote found in git remotes');
}
