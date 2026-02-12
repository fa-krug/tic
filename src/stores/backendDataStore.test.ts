import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { backendDataStore } from './backendDataStore.js';
import { configStore } from './configStore.js';
import { Storage } from '../storage/index.js';
import { defaultConfig } from '../storage/config.js';

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

describe('backendDataStore', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-bds-'));
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

  it('starts with default state', () => {
    const state = backendDataStore.getState();
    expect(state.loaded).toBe(false);
    expect(state.loading).toBe(false);
    expect(state.items).toEqual([]);
    expect(state.syncStatus).toBeNull();
  });

  it('sets loading synchronously on init', () => {
    backendDataStore.getState().init(tmpDir);
    expect(backendDataStore.getState().loading).toBe(true);
  });

  it('loads data from Storage', async () => {
    backendDataStore.getState().init(tmpDir);
    await waitForLoad();

    // Create an item through the backend
    const backend = backendDataStore.getState().backend!;
    await backend.createWorkItem({
      title: 'Item 1',
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

    await backendDataStore.getState().refresh();
    const state = backendDataStore.getState();
    expect(state.loaded).toBe(true);
    expect(state.loading).toBe(false);
    expect(state.items).toHaveLength(1);
    expect(state.items[0]!.id).toBe('1');
    expect(state.statuses).toEqual(defaultConfig.statuses);
    expect(state.types).toEqual(defaultConfig.types);
    expect(state.backend).not.toBeNull();
  });

  it('refresh reloads data silently', async () => {
    backendDataStore.getState().init(tmpDir);
    await waitForLoad();
    expect(backendDataStore.getState().items).toHaveLength(0);

    // Create an item through the backend and refresh
    const backend = backendDataStore.getState().backend!;
    await backend.createWorkItem({
      title: 'Item 1',
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
    await backendDataStore.getState().refresh();
    expect(backendDataStore.getState().items).toHaveLength(1);
    expect(backendDataStore.getState().loading).toBe(false);
  });

  it('destroy resets state', async () => {
    backendDataStore.getState().init(tmpDir);
    await waitForLoad();
    backendDataStore.getState().destroy();
    const state = backendDataStore.getState();
    expect(state.loaded).toBe(false);
    expect(state.items).toEqual([]);
    expect(state.backend).toBeNull();
  });

  it('sets sync status', async () => {
    backendDataStore.getState().init(tmpDir);
    await waitForLoad();
    backendDataStore.getState().setSyncStatus({
      state: 'syncing',
      pendingCount: 3,
      lastSyncTime: null,
      errors: [],
      progress: null,
      syncLog: [],
    });
    expect(backendDataStore.getState().syncStatus?.state).toBe('syncing');
  });

  it('reloadItem updates a single item in the store', async () => {
    backendDataStore.getState().init(tmpDir);
    await waitForLoad();

    const backend = backendDataStore.getState().backend!;
    const item = await backend.createWorkItem({
      title: 'Original',
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
    await backendDataStore.getState().refresh();
    expect(backendDataStore.getState().items).toHaveLength(1);

    // Mutate through backend and do targeted reload
    await backend.updateWorkItem(item.id, { title: 'Updated' });
    await backendDataStore.getState().reloadItem(item.id);

    const items = backendDataStore.getState().items;
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe('Updated');
  });

  it('reloadItem adds a new item if not in store', async () => {
    backendDataStore.getState().init(tmpDir);
    await waitForLoad();
    expect(backendDataStore.getState().items).toHaveLength(0);

    const backend = backendDataStore.getState().backend!;
    const item = await backend.createWorkItem({
      title: 'New',
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
    await backendDataStore.getState().reloadItem(item.id);
    expect(backendDataStore.getState().items).toHaveLength(1);
    expect(backendDataStore.getState().items[0]!.title).toBe('New');
  });

  it('removeItem filters item from store', async () => {
    backendDataStore.getState().init(tmpDir);
    await waitForLoad();

    const backend = backendDataStore.getState().backend!;
    await backend.createWorkItem({
      title: 'To remove',
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
    await backendDataStore.getState().refresh();
    expect(backendDataStore.getState().items).toHaveLength(1);

    backendDataStore.getState().removeItem('1');
    expect(backendDataStore.getState().items).toHaveLength(0);
  });

  it('completes init even with unknown remote backend', async () => {
    // An unknown remote backend type returns null (no sync), but init succeeds
    backendDataStore.getState().init(tmpDir);
    await waitForLoad();
    // Update config to nonexistent backend
    await configStore.getState().update({ backend: 'nonexistent' });
    // Re-init with the bad backend
    backendDataStore.getState().destroy();
    backendDataStore.getState().init(tmpDir);
    await waitForLoad();
    // Should succeed — unknown remote just means no sync
    expect(backendDataStore.getState().error).toBeNull();
    expect(backendDataStore.getState().loaded).toBe(true);
    expect(backendDataStore.getState().loading).toBe(false);
    expect(backendDataStore.getState().syncManager).toBeNull();
  });

  it('handles startPatFlow', () => {
    backendDataStore.getState().startPatFlow();
    expect(backendDataStore.getState().authFlow?.state).toBe('entering-pat');
  });
});
