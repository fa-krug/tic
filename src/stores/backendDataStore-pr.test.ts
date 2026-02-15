import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { backendDataStore } from './backendDataStore.js';
import { defaultPrCapabilities } from './backendDataStore.js';
import { configStore } from './configStore.js';
import { Storage } from '../storage/index.js';
import type { PullRequest } from '../types.js';

/** Wait for backendDataStore to finish loading after init */
async function waitForLoad(): Promise<void> {
  await new Promise<void>((resolve) => {
    const check = () => {
      const state = backendDataStore.getState();
      if (state.loaded || state.error) {
        resolve();
      } else {
        setTimeout(check, 5);
      }
    };
    check();
  });
}

describe('backendDataStore PR support', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-bds-pr-'));
    // Create a Storage to initialize the DB (seed defaults)
    const storage = Storage.create(tmpDir);
    configStore.getState().setDatabase(storage.getDatabase());
    await configStore.getState().init(tmpDir);
    // Close the storage — backendDataStore.init() will create its own
    configStore.getState().setDatabase(null);
    storage.destroy();
  });

  afterEach(() => {
    backendDataStore.getState().destroy();
    configStore.getState().destroy();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('starts with empty pullRequests and default prCapabilities', () => {
    const state = backendDataStore.getState();
    expect(state.pullRequests).toEqual([]);
    expect(state.prCapabilities).toEqual(defaultPrCapabilities);
  });

  it('loads pull requests after init and refresh', async () => {
    // Pre-populate a PR in storage
    const storage = Storage.create(tmpDir);
    const pr: PullRequest = {
      id: 'pr-1',
      number: 1,
      title: 'Test PR',
      description: 'A test pull request',
      status: 'open',
      sourceBranch: 'feature/test',
      targetBranch: 'main',
      author: 'alice',
      linkedItems: [],
      created: '2025-01-01T00:00:00Z',
      updated: '2025-01-01T00:00:00Z',
      url: 'https://example.com/pr/1',
    };
    await storage.importPullRequest(pr);
    storage.destroy();

    backendDataStore.getState().init(tmpDir);
    await waitForLoad();

    const state = backendDataStore.getState();
    expect(state.pullRequests).toHaveLength(1);
    expect(state.pullRequests[0]!.id).toBe('pr-1');
    expect(state.pullRequests[0]!.title).toBe('Test PR');
  });

  it('prCapabilities reflects storage capabilities', async () => {
    backendDataStore.getState().init(tmpDir);
    await waitForLoad();

    const state = backendDataStore.getState();
    // Storage supports pullRequests but not merge or create (those are remote operations)
    expect(state.prCapabilities.pullRequests).toBe(true);
    expect(state.prCapabilities.merge).toBe(false);
    expect(state.prCapabilities.create).toBe(false);
  });

  it('loadPullRequests updates state with PRs from storage', async () => {
    backendDataStore.getState().init(tmpDir);
    await waitForLoad();

    expect(backendDataStore.getState().pullRequests).toHaveLength(0);

    // Import a PR directly through the backend
    const backend = backendDataStore.getState().backend! as Storage;
    const pr: PullRequest = {
      id: 'pr-2',
      number: 2,
      title: 'Another PR',
      description: '',
      status: 'open',
      sourceBranch: 'feature/another',
      targetBranch: 'main',
      author: 'bob',
      linkedItems: [],
      created: '2025-01-02T00:00:00Z',
      updated: '2025-01-02T00:00:00Z',
      url: 'https://example.com/pr/2',
    };
    await backend.importPullRequest(pr);

    await backendDataStore.getState().loadPullRequests();
    expect(backendDataStore.getState().pullRequests).toHaveLength(1);
    expect(backendDataStore.getState().pullRequests[0]!.id).toBe('pr-2');
  });

  it('getLinkedPullRequests returns PRs linked to an item', async () => {
    backendDataStore.getState().init(tmpDir);
    await waitForLoad();

    const backend = backendDataStore.getState().backend! as Storage;

    // Create a work item
    const item = await backend.createWorkItem({
      title: 'Work Item',
      type: 'task',
      status: 'todo',
      priority: 'medium',
      assignee: '',
      labels: [],
      iteration: 'default',
      parent: null,
      dependsOn: [],
      description: '',
    });

    // Import a PR linked to the item
    const pr: PullRequest = {
      id: 'pr-linked',
      number: 3,
      title: 'Linked PR',
      description: '',
      status: 'open',
      sourceBranch: 'feature/linked',
      targetBranch: 'main',
      author: 'charlie',
      linkedItems: [item.id],
      created: '2025-01-03T00:00:00Z',
      updated: '2025-01-03T00:00:00Z',
      url: 'https://example.com/pr/3',
    };
    await backend.importPullRequest(pr);

    const linkedPrs = await backendDataStore
      .getState()
      .getLinkedPullRequests(item.id);
    expect(linkedPrs).toHaveLength(1);
    expect(linkedPrs[0]!.id).toBe('pr-linked');
  });

  it('destroy resets PR state', async () => {
    // Pre-populate a PR
    const storage = Storage.create(tmpDir);
    const pr: PullRequest = {
      id: 'pr-destroy',
      number: 4,
      title: 'Destroy Test',
      description: '',
      status: 'open',
      sourceBranch: 'feature/destroy',
      targetBranch: 'main',
      author: 'dave',
      linkedItems: [],
      created: '2025-01-04T00:00:00Z',
      updated: '2025-01-04T00:00:00Z',
      url: 'https://example.com/pr/4',
    };
    await storage.importPullRequest(pr);
    storage.destroy();

    backendDataStore.getState().init(tmpDir);
    await waitForLoad();
    expect(backendDataStore.getState().pullRequests).toHaveLength(1);

    backendDataStore.getState().destroy();

    const state = backendDataStore.getState();
    expect(state.pullRequests).toEqual([]);
    expect(state.prCapabilities).toEqual(defaultPrCapabilities);
  });

  it('linkPrItem and unlinkPrItem manage PR-item links', async () => {
    backendDataStore.getState().init(tmpDir);
    await waitForLoad();

    const backend = backendDataStore.getState().backend! as Storage;

    // Create a work item and a PR
    const item = await backend.createWorkItem({
      title: 'Linkable Item',
      type: 'task',
      status: 'todo',
      priority: 'medium',
      assignee: '',
      labels: [],
      iteration: 'default',
      parent: null,
      dependsOn: [],
      description: '',
    });

    const pr: PullRequest = {
      id: 'pr-link-test',
      number: 5,
      title: 'Link Test PR',
      description: '',
      status: 'open',
      sourceBranch: 'feature/link-test',
      targetBranch: 'main',
      author: 'eve',
      linkedItems: [],
      created: '2025-01-05T00:00:00Z',
      updated: '2025-01-05T00:00:00Z',
      url: 'https://example.com/pr/5',
    };
    await backend.importPullRequest(pr);

    // Link the PR to the item
    await backendDataStore.getState().linkPrItem('pr-link-test', item.id);

    let linkedPrs = await backendDataStore
      .getState()
      .getLinkedPullRequests(item.id);
    expect(linkedPrs).toHaveLength(1);
    expect(linkedPrs[0]!.id).toBe('pr-link-test');

    // Unlink the PR from the item
    await backendDataStore.getState().unlinkPrItem('pr-link-test', item.id);

    linkedPrs = await backendDataStore
      .getState()
      .getLinkedPullRequests(item.id);
    expect(linkedPrs).toHaveLength(0);
  });
});
