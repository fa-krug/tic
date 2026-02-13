import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { Backend, BackendCapabilities } from '../backends/types.js';
import type { WorkItem } from '../types.js';
import type { SyncQueueAdapter, SyncStatus } from '../sync/types.js';
import type { SyncManager } from '../sync/SyncManager.js';
import { configStore } from './configStore.js';
import { undoStore } from './undoStore.js';

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

export interface AuthPromptInfo {
  backendType: string;
  message: string;
}

export interface AuthFlowState {
  state:
    | 'waiting'
    | 'code-ready'
    | 'entering-pat'
    | 'entering-jira-credentials'
    | 'success'
    | 'error';
  userCode?: string;
  verificationUri?: string;
  error?: string;
}

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

  // Auth state
  authPrompt: AuthPromptInfo | null;
  authFlow: AuthFlowState | null;
  authDismissed: boolean;

  // Backend references
  backend: Backend | null;
  syncManager: SyncManager | null;
  queue: SyncQueueAdapter | null;

  init(cwd: string): void;
  refresh(): Promise<void>;
  reloadItem(id: string): Promise<void>;
  removeItem(id: string): void;
  setSyncStatus(status: SyncStatus): void;
  dismissAuthPrompt(): void;
  startAuthFlow(): Promise<void>;
  startPatFlow(): void;
  submitAdoPat(pat: string): Promise<void>;
  submitJiraCredentials(email: string, token: string): Promise<void>;
  destroy(): void;
}

// Module-level references (not reactive state)
let currentBackend: Backend | null = null;
let currentCwd: string | null = null;
let initGeneration = 0;
let currentSyncUnsubscribe: (() => void) | null = null;

async function createBackendAndSync(cwd: string): Promise<{
  backend: Backend;
  syncManager: SyncManager | null;
  queue: SyncQueueAdapter | null;
  authError: AuthPromptInfo | null;
}> {
  currentCwd = cwd;
  const { Storage } = await import('../storage/index.js');
  const primary = Storage.create(cwd);

  // Set up stores with SQLite backing
  configStore.getState().setDatabase(primary.getDatabase());
  undoStore.getState().setDatabase(primary.getDatabase());

  // Re-read config from DB (may have been loaded with defaults before DB was available)
  await configStore.getState().init(cwd);

  const config = configStore.getState().config;
  const backendType = config.backend ?? 'none';
  const { createRemoteBackend } = await import('../backends/factory.js');
  let remote: Backend | null = null;
  let authError: AuthPromptInfo | null = null;
  try {
    remote = await createRemoteBackend(cwd, backendType, {
      skipAuth: true,
    });
  } catch (err: unknown) {
    // Auth errors are non-fatal — local backend still works, sync is just disabled
    const { AuthError } = await import('../backends/shared/api-client.js');
    if (err instanceof AuthError) {
      authError = {
        backendType,
        message: err.message,
      };
    } else {
      throw err;
    }
  }

  let syncManager: SyncManager | null = null;
  let queue: SyncQueueAdapter | null = null;
  if (remote) {
    const { SyncManager: SM } = await import('../sync/SyncManager.js');
    const { SyncQueue } = await import('../storage/syncQueue.js');
    queue = new SyncQueue(primary.getDatabase());
    syncManager = new SM(primary, remote, queue);
  }

  return { backend: primary, syncManager, queue, authError };
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

    authPrompt: null,
    authFlow: null,
    authDismissed: false,

    backend: null,
    syncManager: null,
    queue: null,

    init(cwd: string) {
      get().destroy();
      const generation = ++initGeneration;
      set({ loading: true });

      void createBackendAndSync(cwd)
        .then(({ backend, syncManager, queue, authError }) => {
          if (generation !== initGeneration) return;
          currentBackend = backend;
          set({ backend, syncManager, queue, authPrompt: authError });

          if (syncManager) {
            currentSyncUnsubscribe?.();
            currentSyncUnsubscribe = syncManager.onStatusChange(
              (status: SyncStatus) => {
                if (generation !== initGeneration) return;
                get().setSyncStatus(status);
                if (status.state === 'idle') {
                  void get().refresh();
                }
              },
            );
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

    dismissAuthPrompt() {
      set({ authPrompt: null, authFlow: null, authDismissed: true });
    },

    startPatFlow() {
      set({ authFlow: { state: 'entering-pat' } });
    },

    async submitAdoPat(pat: string) {
      if (!currentCwd) return;
      const { setAdoPat } = await import('../auth/ado.js');
      setAdoPat(pat);

      set({ authFlow: { state: 'waiting' } });

      try {
        const generation = initGeneration;
        const { createRemoteBackend } = await import('../backends/factory.js');
        const remote = await createRemoteBackend(currentCwd, 'azure');

        if (generation !== initGeneration || !remote || !currentBackend) {
          return;
        }

        const { SyncManager: SM } = await import('../sync/SyncManager.js');
        const { SyncQueue } = await import('../storage/syncQueue.js');
        type StorageType = import('../storage/index.js').Storage;
        const primary = currentBackend as StorageType;
        const queue = new SyncQueue(primary.getDatabase());
        const syncManager = new SM(primary, remote, queue);

        currentSyncUnsubscribe?.();
        currentSyncUnsubscribe = syncManager.onStatusChange(
          (status: SyncStatus) => {
            if (generation !== initGeneration) return;
            get().setSyncStatus(status);
            if (status.state === 'idle') {
              void get().refresh();
            }
          },
        );

        set({
          syncManager,
          queue,
          authPrompt: null,
          authFlow: null,
        });

        syncManager.sync().catch(() => {});
      } catch (err: unknown) {
        set({
          authFlow: {
            state: 'error',
            error: err instanceof Error ? err.message : String(err),
          },
        });
      }
    },

    async submitJiraCredentials(email: string, token: string) {
      if (!currentCwd) return;

      set({ authFlow: { state: 'waiting' } });

      try {
        const generation = initGeneration;
        const config = configStore.getState().config;
        const site = config.jira?.site?.replace(/^https?:\/\//, '');
        if (!site) throw new Error('Jira site not configured');

        // Validate credentials
        const { JiraApiClient } = await import('../backends/jira/api.js');
        const api = new JiraApiClient(email, token, site);
        await api.rest('GET', '/api/3/myself');

        // Store credentials
        const { setJiraCredentials } = await import('../auth/jira.js');
        setJiraCredentials(site, email, token);

        // Create remote backend
        const { createRemoteBackend } = await import('../backends/factory.js');
        const remote = await createRemoteBackend(currentCwd, 'jira');

        if (generation !== initGeneration || !remote || !currentBackend) {
          return;
        }

        const { SyncManager: SM } = await import('../sync/SyncManager.js');
        const { SyncQueue } = await import('../storage/syncQueue.js');
        type StorageType = import('../storage/index.js').Storage;
        const primary = currentBackend as StorageType;
        const queue = new SyncQueue(primary.getDatabase());
        const syncManager = new SM(primary, remote, queue);

        currentSyncUnsubscribe?.();
        currentSyncUnsubscribe = syncManager.onStatusChange(
          (status: SyncStatus) => {
            if (generation !== initGeneration) return;
            get().setSyncStatus(status);
            if (status.state === 'idle') {
              void get().refresh();
            }
          },
        );

        set({
          syncManager,
          queue,
          authPrompt: null,
          authFlow: null,
        });

        syncManager.sync().catch(() => {});
      } catch (err: unknown) {
        set({
          authFlow: {
            state: 'error',
            error: err instanceof Error ? err.message : String(err),
          },
        });
      }
    },

    async startAuthFlow() {
      const { authPrompt } = get();
      if (!authPrompt || !currentCwd) return;

      set({ authFlow: { state: 'waiting' } });

      try {
        const onCode = (userCode: string, verificationUri: string) => {
          set({
            authFlow: {
              state: 'code-ready',
              userCode,
              verificationUri,
            },
          });
        };

        switch (authPrompt.backendType) {
          case 'github': {
            const { authenticateGitHub } = await import('../auth/github.js');
            await authenticateGitHub({ onCode });
            break;
          }
          case 'gitlab': {
            const { authenticateGitLab } = await import('../auth/gitlab.js');
            await authenticateGitLab({ onCode });
            break;
          }
          case 'azure': {
            const { authenticateAdo } = await import('../auth/ado.js');
            await authenticateAdo({ onCode });
            break;
          }
          case 'jira': {
            set({ authFlow: { state: 'entering-jira-credentials' } });
            return; // Wait for form submission
          }
          default:
            throw new Error(
              `Unsupported auth provider: ${authPrompt.backendType}`,
            );
        }

        // Auth succeeded — create remote backend and sync
        const generation = initGeneration;
        const { createRemoteBackend } = await import('../backends/factory.js');
        const remote = await createRemoteBackend(
          currentCwd,
          authPrompt.backendType,
        );

        if (generation !== initGeneration || !remote || !currentBackend) {
          return;
        }

        const { SyncManager: SM } = await import('../sync/SyncManager.js');
        const { SyncQueue } = await import('../storage/syncQueue.js');
        type StorageType = import('../storage/index.js').Storage;
        const primary = currentBackend as StorageType;
        const queue = new SyncQueue(primary.getDatabase());
        const syncManager = new SM(primary, remote, queue);

        currentSyncUnsubscribe?.();
        currentSyncUnsubscribe = syncManager.onStatusChange(
          (status: SyncStatus) => {
            if (generation !== initGeneration) return;
            get().setSyncStatus(status);
            if (status.state === 'idle') {
              void get().refresh();
            }
          },
        );

        set({
          syncManager,
          queue,
          authPrompt: null,
          authFlow: null,
        });

        syncManager.sync().catch(() => {});
      } catch (err: unknown) {
        set({
          authFlow: {
            state: 'error',
            error: err instanceof Error ? err.message : String(err),
          },
        });
      }
    },

    destroy() {
      ++initGeneration;
      currentSyncUnsubscribe?.();
      currentSyncUnsubscribe = null;
      // Null out store DB references before closing the connection
      undoStore.getState().destroy();
      configStore.getState().setDatabase(null);
      if (currentBackend && 'destroy' in currentBackend) {
        (currentBackend as { destroy(): void }).destroy();
      }
      currentBackend = null;
      currentCwd = null;
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
        authPrompt: null,
        authFlow: null,
        authDismissed: false,
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
