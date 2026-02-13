import { execSync } from 'node:child_process';
import type { Backend } from './types.js';
import type { SyncQueueAdapter } from '../sync/types.js';
import { Storage } from '../storage/index.js';
import { SyncQueue } from '../storage/syncQueue.js';
import { configStore } from '../stores/configStore.js';
import { SyncManager } from '../sync/SyncManager.js';

export const VALID_BACKENDS = [
  'none',
  'filesystem',
  'github',
  'gitlab',
  'azure',
  'jira',
] as const;
export type BackendType = (typeof VALID_BACKENDS)[number];

export interface RemoteBackendOptions {
  skipAuth?: boolean;
}

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
  return 'none';
}

export async function createBackend(root: string): Promise<Backend> {
  const primary = Storage.create(root);
  configStore.getState().setDatabase(primary.getDatabase());
  if (!configStore.getState().loaded) {
    await configStore.getState().init(root);
  }
  return primary;
}

export async function createRemoteBackend(
  root: string,
  backendType: string,
  options?: RemoteBackendOptions,
): Promise<Backend | null> {
  switch (backendType) {
    case 'none':
      return null;
    case 'filesystem': {
      const { FilesBackend } = await import('./files/index.js');
      return new FilesBackend(root);
    }
    case 'github': {
      const { GitHubBackend } = await import('./github/index.js');
      return GitHubBackend.create(root, options);
    }
    case 'gitlab': {
      const { GitLabBackend } = await import('./gitlab/index.js');
      return GitLabBackend.create(root, options);
    }
    case 'azure': {
      const { AzureDevOpsBackend } = await import('./ado/index.js');
      return AzureDevOpsBackend.create(root, options);
    }
    case 'jira': {
      const { JiraBackend } = await import('./jira/index.js');
      return JiraBackend.create(root, options);
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
  options?: RemoteBackendOptions,
): Promise<BackendSetup> {
  const primary = Storage.create(root);
  configStore.getState().setDatabase(primary.getDatabase());

  if (!configStore.getState().loaded) {
    await configStore.getState().init(root);
  }

  const config = configStore.getState().config;
  const remote = await createRemoteBackend(
    root,
    config.backend ?? 'none',
    options,
  );

  let syncManager: SyncManager | null = null;
  let queue: SyncQueueAdapter | null = null;
  if (remote) {
    queue = new SyncQueue(primary.getDatabase());
    syncManager = new SyncManager(primary, remote, queue);
  }

  return { backend: primary, syncManager, queue };
}
