import { execSync } from 'node:child_process';
import type { Backend } from './types.js';
import type { SyncQueueAdapter } from '../sync/types.js';
import { DrizzleBackend } from './drizzle/index.js';
import { DrizzleSyncQueue } from './drizzle/syncQueue.js';
import { configStore } from '../stores/configStore.js';
import { SyncManager } from '../sync/SyncManager.js';

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
  return DrizzleBackend.create(root);
}

async function createRemoteBackend(
  root: string,
  backendType: string,
): Promise<Backend | null> {
  switch (backendType) {
    case 'local':
    case 'none':
      return null;
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
      return null;
  }
}

export interface BackendSetup {
  backend: Backend;
  syncManager: SyncManager | null;
  queue: SyncQueueAdapter | null;
}

export async function createBackendWithSync(
  root: string,
): Promise<BackendSetup> {
  if (!configStore.getState().loaded) {
    await configStore.getState().init(root);
  }

  const primary = DrizzleBackend.create(root);
  configStore.getState().setDatabase(primary.getDatabase());

  const config = configStore.getState().config;
  const remote = await createRemoteBackend(root, config.backend ?? 'none');

  let syncManager: SyncManager | null = null;
  let queue: SyncQueueAdapter | null = null;
  if (remote) {
    queue = new DrizzleSyncQueue(primary.getDatabase());
    syncManager = new SyncManager(primary, remote, queue);
  }

  return { backend: primary, syncManager, queue };
}
