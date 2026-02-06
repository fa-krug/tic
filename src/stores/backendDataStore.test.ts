import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { backendDataStore } from './backendDataStore.js';
import { configStore } from './configStore.js';
import { defaultConfig, writeConfig } from '../backends/local/config.js';
import { writeWorkItem } from '../backends/local/items.js';
import type { WorkItem } from '../types.js';

function makeItem(id: string, overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id,
    title: `Item ${id}`,
    status: 'todo',
    type: 'task',
    iteration: 'default',
    priority: 'medium',
    assignee: '',
    labels: [],
    created: '2025-01-01T00:00:00Z',
    updated: '2025-01-01T00:00:00Z',
    description: '',
    comments: [],
    parent: null,
    dependsOn: [],
    ...overrides,
  };
}

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
    await writeConfig(tmpDir, { ...defaultConfig });
    await configStore.getState().init(tmpDir);
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

  it('loads data from local backend', async () => {
    const item = makeItem('1');
    await writeWorkItem(tmpDir, item);

    backendDataStore.getState().init(tmpDir);
    await waitForLoad();

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

    // Write an item and refresh
    await writeWorkItem(tmpDir, makeItem('1'));
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
    });
    expect(backendDataStore.getState().syncStatus?.state).toBe('syncing');
  });

  it('handles backend init failure gracefully', async () => {
    // Configure an invalid backend type that will fail in createBackendAndSync
    await configStore.getState().update({ backend: 'nonexistent' });
    backendDataStore.getState().init(tmpDir);
    await waitForLoad();
    // Should have an error but not throw
    expect(backendDataStore.getState().error).toBeTruthy();
    expect(backendDataStore.getState().error).toContain('Unknown backend');
    expect(backendDataStore.getState().loaded).toBe(true);
    expect(backendDataStore.getState().loading).toBe(false);
  });
});
