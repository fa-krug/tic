import { describe, it, expect, afterEach } from 'vitest';
import { backendDataStore } from './backendDataStore.js';
import type { Backend, BackendCapabilities } from '../backends/types.js';
import type { WorkItem } from '../types.js';

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

const allTrue: BackendCapabilities = {
  relationships: true,
  customTypes: true,
  customStatuses: true,
  iterations: true,
  comments: true,
  fields: {
    priority: true,
    assignee: true,
    labels: true,
    parent: true,
    dependsOn: true,
  },
  templates: true,
  templateFields: {
    type: true,
    status: true,
    priority: true,
    assignee: true,
    labels: true,
    iteration: true,
    parent: true,
    dependsOn: true,
    description: true,
  },
};

function mockBackend(items: WorkItem[] = []): Backend {
  /* eslint-disable @typescript-eslint/require-await */
  return {
    getCapabilities: () => allTrue,
    getStatuses: async () => ['open', 'closed'],
    getIterations: async () => ['v1', 'v2'],
    getWorkItemTypes: async () => ['task', 'bug'],
    getAssignees: async () => ['alice', 'bob'],
    getLabels: async () => ['frontend', 'backend'],
    getCurrentIteration: async () => 'v1',
    listWorkItems: async () => items,
  } as unknown as Backend;
  /* eslint-enable @typescript-eslint/require-await */
}

describe('backendDataStore', () => {
  afterEach(() => {
    backendDataStore.getState().destroy();
  });

  it('starts with default state', () => {
    const state = backendDataStore.getState();
    expect(state.loaded).toBe(false);
    expect(state.loading).toBe(false);
    expect(state.items).toEqual([]);
    expect(state.syncStatus).toBeNull();
  });

  it('loads data on init', async () => {
    const items: WorkItem[] = [
      {
        id: '1',
        title: 'Test',
        status: 'open',
        type: 'task',
        iteration: 'v1',
        priority: 'medium',
        assignee: '',
        labels: [],
        created: '2025-01-01',
        updated: '2025-01-01',
        description: '',
        comments: [],
        parent: null,
        dependsOn: [],
      },
    ];
    backendDataStore.getState().init(mockBackend(items));
    await waitForLoad();
    const state = backendDataStore.getState();
    expect(state.loaded).toBe(true);
    expect(state.loading).toBe(false);
    expect(state.items).toEqual(items);
    expect(state.statuses).toEqual(['open', 'closed']);
    expect(state.iterations).toEqual(['v1', 'v2']);
    expect(state.types).toEqual(['task', 'bug']);
    expect(state.assignees).toEqual(['alice', 'bob']);
    expect(state.labels).toEqual(['frontend', 'backend']);
    expect(state.currentIteration).toBe('v1');
    expect(state.capabilities).toBe(allTrue);
  });

  it('refresh reloads data silently', async () => {
    const backend = mockBackend();
    backendDataStore.getState().init(backend);
    await waitForLoad();
    // Mutate the mock to return different data
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await
    (backend as any).getStatuses = async () => [
      'open',
      'closed',
      'in-progress',
    ];
    await backendDataStore.getState().refresh();
    expect(backendDataStore.getState().statuses).toEqual([
      'open',
      'closed',
      'in-progress',
    ]);
    // loading should NOT have been set to true during refresh
    expect(backendDataStore.getState().loading).toBe(false);
  });

  it('destroy resets state', async () => {
    backendDataStore.getState().init(mockBackend());
    await waitForLoad();
    backendDataStore.getState().destroy();
    const state = backendDataStore.getState();
    expect(state.loaded).toBe(false);
    expect(state.items).toEqual([]);
  });

  it('sets sync status', async () => {
    backendDataStore.getState().init(mockBackend());
    await waitForLoad();
    backendDataStore.getState().setSyncStatus({
      state: 'syncing',
      pendingCount: 3,
      lastSyncTime: null,
      errors: [],
    });
    expect(backendDataStore.getState().syncStatus?.state).toBe('syncing');
  });

  it('handles init error gracefully', async () => {
    const backend = mockBackend();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/require-await
    (backend as any).getStatuses = async () => {
      throw new Error('network error');
    };
    backendDataStore.getState().init(backend);
    await waitForLoad();
    expect(backendDataStore.getState().error).toBe('network error');
    // loading should be false after error
  });
});
