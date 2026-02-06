import { execSync } from 'node:child_process';
import type { Backend } from './types.js';
import { LocalBackend } from './local/index.js';
import { configStore } from '../stores/configStore.js';
import { SyncManager } from '../sync/SyncManager.js';
import { SyncQueueStore } from '../sync/queue.js';

export const VALID_BACKENDS = [
  'local',
  'github',
  'gitlab',
  'azure',
  'jira',
] as const;
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

export async function createBackend(root: string): Promise<Backend> {
  if (!configStore.getState().loaded) {
    await configStore.getState().init(root);
  }
  const backend = configStore.getState().config.backend ?? 'local';

  switch (backend) {
    case 'local':
      return LocalBackend.create(root);
    case 'github': {
      const { GitHubBackend } = await import('./github/index.js');
      return new GitHubBackend(root);
    }
    case 'gitlab': {
      const { GitLabBackend } = await import('./gitlab/index.js');
      return new GitLabBackend(root);
    }
    case 'azure': {
      const { AzureDevOpsBackend } = await import('./ado/index.js');
      return new AzureDevOpsBackend(root);
    }
    case 'jira': {
      const { JiraBackend } = await import('./jira/index.js');
      return JiraBackend.create(root);
    }
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

export async function createBackendWithSync(
  root: string,
): Promise<BackendSetup> {
  if (!configStore.getState().loaded) {
    await configStore.getState().init(root);
  }
  const backendType = configStore.getState().config.backend ?? 'local';

  const local = await LocalBackend.create(root, {
    tempIds: backendType !== 'local',
  });

  if (backendType === 'local') {
    return { backend: local, syncManager: null };
  }

  let remote: Backend;
  switch (backendType) {
    case 'github': {
      const { GitHubBackend } = await import('./github/index.js');
      remote = new GitHubBackend(root);
      break;
    }
    case 'gitlab': {
      const { GitLabBackend } = await import('./gitlab/index.js');
      remote = new GitLabBackend(root);
      break;
    }
    case 'azure': {
      const { AzureDevOpsBackend } = await import('./ado/index.js');
      remote = new AzureDevOpsBackend(root);
      break;
    }
    case 'jira': {
      const { JiraBackend } = await import('./jira/index.js');
      remote = await JiraBackend.create(root);
      break;
    }
    default:
      throw new Error(
        `Unknown backend "${backendType}". Valid backends: ${VALID_BACKENDS.join(', ')}`,
      );
  }

  const queueStore = new SyncQueueStore(root);
  const syncManager = new SyncManager(local, remote, queueStore);

  return { backend: local, syncManager };
}
