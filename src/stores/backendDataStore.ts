import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { Backend, BackendCapabilities } from '../backends/types.js';
import type { WorkItem } from '../types.js';
import type { SyncStatus } from '../sync/types.js';
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

  init(cwd: string): void;
  refresh(): Promise<void>;
  setSyncStatus(status: SyncStatus): void;
  destroy(): void;
}

// Module-level references (not reactive state)
let currentBackend: Backend | null = null;
let initGeneration = 0;

async function createBackendAndSync(cwd: string): Promise<{
  backend: Backend;
  syncManager: SyncManager | null;
}> {
  const { LocalBackend } = await import('../backends/local/index.js');
  const backendType = configStore.getState().config.backend ?? 'local';

  const local = await LocalBackend.create(cwd, {
    tempIds: backendType !== 'local',
  });

  if (backendType === 'local') {
    return { backend: local, syncManager: null };
  }

  // Dynamic import of remote backend — this is the expensive part
  let remote: Backend;
  switch (backendType) {
    case 'github': {
      const { GitHubBackend } = await import('../backends/github/index.js');
      remote = new GitHubBackend(cwd);
      break;
    }
    case 'gitlab': {
      const { GitLabBackend } = await import('../backends/gitlab/index.js');
      remote = new GitLabBackend(cwd);
      break;
    }
    case 'azure': {
      const { AzureDevOpsBackend } = await import('../backends/ado/index.js');
      remote = new AzureDevOpsBackend(cwd);
      break;
    }
    case 'jira': {
      const { JiraBackend } = await import('../backends/jira/index.js');
      remote = await JiraBackend.create(cwd);
      break;
    }
    default:
      throw new Error(`Unknown backend "${backendType}"`);
  }

  const { SyncQueueStore } = await import('../sync/queue.js');
  const { SyncManager } = await import('../sync/SyncManager.js');
  const queueStore = new SyncQueueStore(cwd);
  const syncManager = new SyncManager(local, remote, queueStore);

  return { backend: local, syncManager };
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

    init(cwd: string) {
      get().destroy();
      const generation = ++initGeneration;
      set({ loading: true });

      void createBackendAndSync(cwd)
        .then(({ backend, syncManager }) => {
          if (generation !== initGeneration) return;
          currentBackend = backend;
          set({ backend, syncManager });

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
      });
    },
  }),
);

export function useBackendDataStore<T>(
  selector: (state: BackendDataStoreState) => T,
): T {
  return useStore(backendDataStore, selector);
}
