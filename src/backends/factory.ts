import { execSync } from 'node:child_process';
import type { Backend } from './types.js';
import { LocalBackend } from './local/index.js';
import { GitHubBackend } from './github/index.js';
import { GitLabBackend } from './gitlab/index.js';
import { AzureDevOpsBackend } from './ado/index.js';
import { readConfig } from './local/config.js';
import { SyncManager } from '../sync/SyncManager.js';
import { SyncQueueStore } from '../sync/queue.js';

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
    if (
      output.includes('dev.azure.com') ||
      output.includes('ssh.dev.azure.com') ||
      /\w+\.visualstudio\.com/.test(output)
    )
      return 'azure';
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
      return new GitLabBackend(root);
    case 'azure':
      return new AzureDevOpsBackend(root);
    default:
      throw new Error(
        `Unknown backend "${backend}". Valid backends: ${VALID_BACKENDS.join(', ')}`,
      );
  }
}

export interface BackendSetup {
  backend: LocalBackend;
  syncManager: SyncManager | null;
}

export function createBackendWithSync(root: string): BackendSetup {
  const config = readConfig(root);
  const backendType = config.backend ?? 'local';

  const local = new LocalBackend(root, { tempIds: backendType !== 'local' });

  if (backendType === 'local') {
    return { backend: local, syncManager: null };
  }

  let remote: Backend;
  switch (backendType) {
    case 'github':
      remote = new GitHubBackend(root);
      break;
    case 'gitlab':
      remote = new GitLabBackend(root);
      break;
    case 'azure':
      remote = new AzureDevOpsBackend(root);
      break;
    default:
      throw new Error(
        `Unknown backend "${backendType}". Valid backends: ${VALID_BACKENDS.join(', ')}`,
      );
  }

  const queueStore = new SyncQueueStore(root);
  const syncManager = new SyncManager(local, remote, queueStore);

  return { backend: local, syncManager };
}
