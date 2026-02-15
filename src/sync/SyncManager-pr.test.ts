import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SyncManager } from './SyncManager.js';
import { Storage } from '../storage/index.js';
import { SyncQueue } from '../storage/syncQueue.js';
import type { Backend } from '../backends/types.js';
import type { WorkItem, PullRequest } from '../types.js';
import type { QueueAction } from './types.js';
import { createMockRemote, makePullRequest } from '../test-helpers.js';

function createMockPrRemote(
  prs: PullRequest[],
  items: WorkItem[] = [],
): Backend & { listPullRequests: () => Promise<PullRequest[]> } {
  const base = createMockRemote(items);
  return {
    ...base,
    // eslint-disable-next-line @typescript-eslint/require-await
    listPullRequests: async () => prs,
  };
}

describe('PR queue action types', () => {
  it('pr-create is a valid QueueAction', () => {
    const action: QueueAction = 'pr-create';
    expect(action).toBe('pr-create');
  });

  it('pr-update is a valid QueueAction', () => {
    const action: QueueAction = 'pr-update';
    expect(action).toBe('pr-update');
  });

  it('pr-link is a valid QueueAction', () => {
    const action: QueueAction = 'pr-link';
    expect(action).toBe('pr-link');
  });

  it('pr-unlink is a valid QueueAction', () => {
    const action: QueueAction = 'pr-unlink';
    expect(action).toBe('pr-unlink');
  });
});

describe('SyncManager PR pull', () => {
  let tmpDir: string;
  let local: Storage;
  let queueStore: SyncQueue;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-sync-pr-test-'));
    local = Storage.create(tmpDir);
    queueStore = new SyncQueue(local.getDatabase());
  });

  afterEach(() => {
    local.destroy();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('imports PRs from remote during pull when remote supports PRs', async () => {
    const pr = makePullRequest();
    const remote = createMockPrRemote([pr]);
    const manager = new SyncManager(local, remote, queueStore);

    await manager.sync();

    const storedPr = await local.getPullRequest('pr-1');
    expect(storedPr).not.toBeNull();
    expect(storedPr!.title).toBe('Test PR');
    expect(storedPr!.author).toBe('testuser');
  });

  it('imports multiple PRs from remote during pull', async () => {
    const pr1 = makePullRequest({ id: 'pr-1', number: 1, title: 'First PR' });
    const pr2 = makePullRequest({ id: 'pr-2', number: 2, title: 'Second PR' });
    const remote = createMockPrRemote([pr1, pr2]);
    const manager = new SyncManager(local, remote, queueStore);

    await manager.sync();

    const stored1 = await local.getPullRequest('pr-1');
    const stored2 = await local.getPullRequest('pr-2');
    expect(stored1).not.toBeNull();
    expect(stored1!.title).toBe('First PR');
    expect(stored2).not.toBeNull();
    expect(stored2!.title).toBe('Second PR');
  });

  it('does not attempt PR pull when remote does not support PRs', async () => {
    const remote = createMockRemote(); // no listPullRequests method
    const importSpy = vi.spyOn(local, 'importPullRequest');
    const manager = new SyncManager(local, remote, queueStore);

    await manager.sync();

    expect(importSpy).not.toHaveBeenCalled();
  });

  it('upserts PRs on repeated pull (updates existing)', async () => {
    const pr = makePullRequest({ title: 'Original Title' });
    const remote = createMockPrRemote([pr]);
    const manager = new SyncManager(local, remote, queueStore);

    await manager.sync();

    // Update the PR title for second sync
    const updatedPr = makePullRequest({
      title: 'Updated Title',
      status: 'merged',
    });
    const remote2 = createMockPrRemote([updatedPr]);
    const manager2 = new SyncManager(local, remote2, queueStore);

    await manager2.sync();

    const storedPr = await local.getPullRequest('pr-1');
    expect(storedPr).not.toBeNull();
    expect(storedPr!.title).toBe('Updated Title');
    expect(storedPr!.status).toBe('merged');
  });

  it('handles pr-* queue actions via default case in pushEntry (no-op)', async () => {
    const remote = createMockRemote();
    const manager = new SyncManager(local, remote, queueStore);

    queueStore.append({
      action: 'pr-create',
      itemId: 'pr-1',
      timestamp: new Date().toISOString(),
    });

    const result = await manager.pushPending();
    expect(result.pushed).toBe(1);
    expect(result.failed).toBe(0);
    expect(queueStore.read().pending).toHaveLength(0);
  });
});
