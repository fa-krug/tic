import { execSync } from 'node:child_process';

export interface AdoRemoteInfo {
  org: string;
  project: string;
}

export function parseAdoRemote(cwd: string): AdoRemoteInfo {
  const output = execSync('git remote -v', {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const lines = output.split('\n');
  for (const line of lines) {
    // HTTPS: https://dev.azure.com/{org}/{project}/_git/{repo}
    const httpsMatch = line.match(/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\//);
    if (httpsMatch) {
      return {
        org: httpsMatch[1]!,
        project: decodeURIComponent(httpsMatch[2]!),
      };
    }

    // SSH: git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
    const sshMatch = line.match(
      /ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/[^/]+/,
    );
    if (sshMatch) {
      return {
        org: sshMatch[1]!,
        project: decodeURIComponent(sshMatch[2]!),
      };
    }

    // Legacy: https://{org}.visualstudio.com/{project}/_git/{repo}
    const legacyMatch = line.match(
      /([^/.]+)\.visualstudio\.com\/([^/]+)\/_git\//,
    );
    if (legacyMatch) {
      return {
        org: legacyMatch[1]!,
        project: decodeURIComponent(legacyMatch[2]!),
      };
    }
  }

  throw new Error('No Azure DevOps remote found in git remotes');
}
