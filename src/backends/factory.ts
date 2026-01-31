import { execSync } from 'node:child_process';
import type { Backend } from './types.js';
import { LocalBackend } from './local/index.js';
import { GitHubBackend } from './github/index.js';
import { readConfig } from './local/config.js';

export const VALID_BACKENDS = ['local', 'github', 'gitlab', 'azure'] as const;
export type BackendType = (typeof VALID_BACKENDS)[number];

export function detectBackend(root: string): BackendType {
  try {
    const output = execSync('git remote -v', {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (output.includes('github.com')) return 'github';
    if (output.includes('gitlab.com')) return 'gitlab';
    if (output.includes('dev.azure.com')) return 'azure';
  } catch {
    // Not a git repo or git not available
  }
  return 'local';
}

export function createBackend(root: string): Backend {
  const config = readConfig(root);
  const backend = config.backend ?? 'local';

  switch (backend) {
    case 'local':
      return new LocalBackend(root);
    case 'github':
      return new GitHubBackend(root);
    case 'gitlab':
    case 'azure':
      throw new Error(
        `Backend "${backend}" is not yet implemented. Use "local" for now.`,
      );
    default:
      throw new Error(
        `Unknown backend "${backend}". Valid backends: ${VALID_BACKENDS.join(', ')}`,
      );
  }
}
