import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { Backend, BackendCapabilities } from '../backends/types.js';
import type { WorkItem } from '../types.js';
import type { SyncQueueAdapter, SyncStatus } from '../sync/types.js';
import type { SyncManager } from '../sync/SyncManager.js';
import { configStore } from './configStore.js';

export const defaultCapabilities: BackendCapabilities = {
  relationships: false,
  customTypes: false,
  customStatuses: false,
  iterations: false,
  comments: false,
  fields: {
    priority: false,
    assignee: false,
    labels: false,
    parent: false,
    dependsOn: false,
  },
  templates: false,
  templateFields: {
    type: false,
    status: false,
    priority: false,
    assignee: false,
    labels: false,
    iteration: false,
    parent: false,
    dependsOn: false,
    description: false,
  },
};

export interface BackendDataStoreState {
  items: WorkItem[];
  capabilities: BackendCapabilities;
  statuses: string[];
  iterations: string[];
  types: string[];
  assignees: string[];
  labels: string[];
  currentIteration: string;

  loaded: boolean;
  loading: boolean;
  error: string | null;
  syncStatus: SyncStatus | null;

  // Backend references
  backend: Backend | null;
  syncManager: SyncManager | null;
  queue: SyncQueueAdapter | null;

  init(cwd: string): void;
  refresh(): Promise<void>;
  reloadItem(id: string): Promise<void>;
  removeItem(id: string): void;
  setSyncStatus(status: SyncStatus): void;
  destroy(): void;
}

// Module-level references (not reactive state)
let currentBackend: Backend | null = null;
let initGeneration = 0;

async function createBackendAndSync(cwd: string): Promise<{
  backend: Backend;
  syncManager: SyncManager | null;
  queue: SyncQueueAdapter | null;
}> {
  const { Storage } = await import('../storage/index.js');
  const primary = Storage.create(cwd);

  // Set up configStore with SQLite backing
  configStore.getState().setDatabase(primary.getDatabase());

  const config = configStore.getState().config;
  const { createRemoteBackend } = await import('../backends/factory.js');
  const remote = await createRemoteBackend(cwd, config.backend ?? 'none');

  let syncManager: SyncManager | null = null;
  let queue: SyncQueueAdapter | null = null;
  if (remote) {
    const { SyncManager: SM } = await import('../sync/SyncManager.js');
    const { SyncQueue } = await import('../storage/syncQueue.js');
    queue = new SyncQueue(primary.getDatabase());
    syncManager = new SM(primary, remote, queue);
  }

  return { backend: primary, syncManager, queue };
}

export const backendDataStore = createStore<BackendDataStoreState>(
  (set, get) => ({
    items: [],
    capabilities: { ...defaultCapabilities },
    statuses: [],
    iterations: [],
    types: [],
    assignees: [],
    labels: [],
    currentIteration: '',

    loaded: false,
    loading: false,
    error: null,
    syncStatus: null,

    backend: null,
    syncManager: null,
    queue: null,

    init(cwd: string) {
      get().destroy();
      const generation = ++initGeneration;
      set({ loading: true });

      void createBackendAndSync(cwd)
        .then(({ backend, syncManager, queue }) => {
          if (generation !== initGeneration) return;
          currentBackend = backend;
          set({ backend, syncManager, queue });

          if (syncManager) {
            syncManager.onStatusChange((status: SyncStatus) => {
              if (generation !== initGeneration) return;
              get().setSyncStatus(status);
              if (status.state === 'idle') {
                void get().refresh();
              }
            });
            syncManager.sync().catch(() => {});
          }

          return get().refresh();
        })
        .then(() => {
          if (generation !== initGeneration) return;
          configStore.getState().startWatching();
          set({ loaded: true, loading: false });
        })
        .catch((err: unknown) => {
          if (generation !== initGeneration) return;
          set({
            error: err instanceof Error ? err.message : String(err),
            loaded: true,
            loading: false,
          });
        });
    },

    async refresh() {
      if (!currentBackend) return;

      try {
        const iter = await currentBackend.getCurrentIteration();
        const [statuses, iterations, types, assignees, labels, items] =
          await Promise.all([
            currentBackend.getStatuses(),
            currentBackend.getIterations(),
            currentBackend.getWorkItemTypes(),
            currentBackend.getAssignees().catch(() => [] as string[]),
            currentBackend.getLabels().catch(() => [] as string[]),
            currentBackend.listWorkItems(iter),
          ]);

        set({
          capabilities: currentBackend.getCapabilities(),
          statuses,
          iterations,
          types,
          assignees,
          labels,
          currentIteration: iter,
          items,
          error: null,
        });
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e) });
      }
    },

    async reloadItem(id: string) {
      if (!currentBackend) return;
      try {
        const item = await currentBackend.getWorkItem(id);
        set((state) => {
          const idx = state.items.findIndex((i) => i.id === id);
          const items = [...state.items];
          if (idx >= 0) {
            items[idx] = item;
          } else {
            items.push(item);
          }
          return { items };
        });
        // Refresh dynamic lists that may have changed
        const [assignees, labels] = await Promise.all([
          currentBackend.getAssignees().catch(() => [] as string[]),
          currentBackend.getLabels().catch(() => [] as string[]),
        ]);
        set({ assignees, labels });
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e) });
      }
    },

    removeItem(id: string) {
      set((state) => ({
        items: state.items.filter((i) => i.id !== id),
      }));
    },

    setSyncStatus(status: SyncStatus) {
      set({ syncStatus: status });
    },

    destroy() {
      ++initGeneration;
      currentBackend = null;
      set({
        items: [],
        capabilities: { ...defaultCapabilities },
        statuses: [],
        iterations: [],
        types: [],
        assignees: [],
        labels: [],
        currentIteration: '',
        loaded: false,
        loading: false,
        error: null,
        syncStatus: null,
        backend: null,
        syncManager: null,
        queue: null,
      });
    },
  }),
);

export function useBackendDataStore<T>(
  selector: (state: BackendDataStoreState) => T,
): T {
  return useStore(backendDataStore, selector);
}
