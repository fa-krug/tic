import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type {
  Backend,
  BackendCapabilities,
  PrCapabilities,
} from '../backends/types.js';
import { isPrBackend } from '../backends/types.js';
import type { WorkItem, PullRequest, NewPullRequest } from '../types.js';
import type { SyncQueueAdapter, SyncStatus } from '../sync/types.js';
import type { SyncManager } from '../sync/SyncManager.js';
import { configStore } from './configStore.js';
import { undoStore } from './undoStore.js';
import { themeStore } from './themeStore.js';
import {
  isGitRepo,
  listBranches,
  listWorktrees,
  type BranchRow,
} from '../git.js';
import { fetchAll } from '../git-async.js';
import { linkBranchToItem } from '../branch-links.js';

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

export const defaultPrCapabilities: PrCapabilities = {
  pullRequests: false,
  merge: false,
  create: false,
};

export interface BackendDataStoreState {
  items: WorkItem[];
  capabilities: BackendCapabilities;
  pullRequests: PullRequest[];
  prCapabilities: PrCapabilities;
  branches: BranchRow[];
  branchesLoading: boolean;
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

  // PR operations
  loadPullRequests: () => Promise<void>;
  getLinkedPullRequests: (itemId: string) => Promise<PullRequest[]>;
  createPullRequest: (pr: NewPullRequest) => Promise<PullRequest>;
  mergePullRequest: (id: string) => Promise<PullRequest>;
  closePullRequest: (id: string) => Promise<PullRequest>;
  linkPrItem: (prId: string, itemId: string) => Promise<void>;
  unlinkPrItem: (prId: string, itemId: string) => Promise<void>;

  // Branch operations
  loadBranches: () => void;
  refreshBranches: () => void;

  // Color mapping operations (delegate to Storage)
  setColorMapping(
    fieldType: string,
    value: string,
    bg: string,
    fg: string,
  ): Promise<void>;
  deleteColorMapping(fieldType: string, value: string): Promise<void>;
  deleteColorMappingsByField(fieldType: string): Promise<void>;
  reloadColorOverrides(): Promise<void>;
}

// Module-level references (not reactive state)
let currentBackend: Backend | null = null;
let currentRemoteBackend: Backend | null = null;
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

  // Load user color overrides for field pills
  const colorMappings = await primary.getColorMappings();
  themeStore.getState().loadColorOverrides(colorMappings);

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

  currentRemoteBackend = remote;

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
    pullRequests: [],
    prCapabilities: { ...defaultPrCapabilities },
    branches: [],
    branchesLoading: false,
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
            syncManager.sync().catch(() => {
              // Errors are recorded in syncStatus by SyncManager
            });
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
        const [statuses, iterations, types, items] = await Promise.all([
          currentBackend.getStatuses(),
          currentBackend.getIterations(),
          currentBackend.getWorkItemTypes(),
          currentBackend.listWorkItems(iter),
        ]);

        // Derive assignees and labels from loaded items
        const assigneeSet = new Set<string>();
        const labelSet = new Set<string>();
        for (const item of items) {
          if (item.assignee) assigneeSet.add(item.assignee);
          for (const label of item.labels) labelSet.add(label);
        }

        set({
          capabilities: currentBackend.getCapabilities(),
          statuses,
          iterations,
          types,
          assignees: [...assigneeSet].sort(),
          labels: [...labelSet].sort(),
          currentIteration: iter,
          items,
          error: null,
        });

        await get().loadPullRequests();
        get().loadBranches();
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

          // Re-derive assignees and labels from updated items list
          const assigneeSet = new Set<string>();
          const labelSet = new Set<string>();
          for (const i of items) {
            if (i.assignee) assigneeSet.add(i.assignee);
            for (const label of i.labels) labelSet.add(label);
          }

          return {
            items,
            assignees: [...assigneeSet].sort(),
            labels: [...labelSet].sort(),
          };
        });
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

        currentRemoteBackend = remote;

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

        syncManager.sync().catch(() => {
          // Errors are recorded in syncStatus by SyncManager
        });
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

        currentRemoteBackend = remote;

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

        syncManager.sync().catch(() => {
          // Errors are recorded in syncStatus by SyncManager
        });
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

        currentRemoteBackend = remote;

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

        syncManager.sync().catch(() => {
          // Errors are recorded in syncStatus by SyncManager
        });
      } catch (err: unknown) {
        set({
          authFlow: {
            state: 'error',
            error: err instanceof Error ? err.message : String(err),
          },
        });
      }
    },

    // PR operations
    async loadPullRequests() {
      if (!currentBackend) return;
      if (isPrBackend(currentBackend)) {
        const [pullRequests, prCapabilities] = await Promise.all([
          currentBackend.listPullRequests(),
          Promise.resolve(currentBackend.getPrCapabilities()),
        ]);
        set({ pullRequests, prCapabilities });
      } else {
        set({ pullRequests: [], prCapabilities: { ...defaultPrCapabilities } });
      }
    },

    // Branch operations
    loadBranches() {
      if (!currentCwd || !isGitRepo(currentCwd)) {
        set({ branches: [], branchesLoading: false });
        return;
      }
      const cwd = currentCwd;
      const items = get().items;
      const branches = listBranches(cwd);
      const worktrees = listWorktrees(cwd);

      const rows: BranchRow[] = branches.map((b) => {
        const linked = linkBranchToItem(b.name, items);
        const wt = worktrees.find((w) => w.branch === b.name) ?? null;
        return {
          branch: b,
          linkedItem: linked ? { id: linked.id, title: linked.title } : null,
          worktree: wt,
        };
      });

      rows.sort((a, b) => {
        if (a.branch.current !== b.branch.current)
          return a.branch.current ? -1 : 1;
        const aIsTic = a.branch.name.startsWith('tic/');
        const bIsTic = b.branch.name.startsWith('tic/');
        if (aIsTic !== bIsTic) return aIsTic ? -1 : 1;
        return a.branch.name.localeCompare(b.branch.name);
      });

      set({ branches: rows });
    },

    refreshBranches() {
      if (!currentCwd || !isGitRepo(currentCwd)) return;
      const cwd = currentCwd;
      const gen = initGeneration;
      get().loadBranches();
      set({ branchesLoading: true });
      fetchAll(cwd)
        .then(() => {
          if (gen !== initGeneration) return;
          get().loadBranches();
        })
        .catch(() => {})
        .finally(() => {
          if (gen !== initGeneration) return;
          set({ branchesLoading: false });
        });
    },

    async getLinkedPullRequests(itemId: string) {
      if (!currentBackend || !isPrBackend(currentBackend)) return [];
      return currentBackend.getLinkedPullRequests(itemId);
    },

    async createPullRequest(pr: NewPullRequest) {
      if (!currentRemoteBackend || !isPrBackend(currentRemoteBackend)) {
        throw new Error('Remote backend does not support pull requests');
      }
      const result = await currentRemoteBackend.createPullRequest(pr);
      // Import into local storage
      if (currentBackend && isPrBackend(currentBackend)) {
        type StorageType = import('../storage/index.js').Storage;
        await (currentBackend as StorageType).importPullRequest(result);
      }
      await get().loadPullRequests();
      return result;
    },

    async mergePullRequest(id: string) {
      if (!currentRemoteBackend || !isPrBackend(currentRemoteBackend)) {
        throw new Error('Remote backend does not support pull requests');
      }
      const result = await currentRemoteBackend.mergePullRequest(id);
      if (currentBackend && isPrBackend(currentBackend)) {
        type StorageType = import('../storage/index.js').Storage;
        await (currentBackend as StorageType).importPullRequest(result);
      }
      await get().loadPullRequests();
      return result;
    },

    async closePullRequest(id: string) {
      if (!currentRemoteBackend || !isPrBackend(currentRemoteBackend)) {
        throw new Error('Remote backend does not support pull requests');
      }
      const result = await currentRemoteBackend.closePullRequest(id);
      if (currentBackend && isPrBackend(currentBackend)) {
        type StorageType = import('../storage/index.js').Storage;
        await (currentBackend as StorageType).importPullRequest(result);
      }
      await get().loadPullRequests();
      return result;
    },

    async linkPrItem(prId: string, itemId: string) {
      if (!currentBackend || !isPrBackend(currentBackend)) return;
      await currentBackend.linkItem(prId, itemId);
      await get().loadPullRequests();
    },

    async unlinkPrItem(prId: string, itemId: string) {
      if (!currentBackend || !isPrBackend(currentBackend)) return;
      await currentBackend.unlinkItem(prId, itemId);
      await get().loadPullRequests();
    },

    async setColorMapping(
      fieldType: string,
      value: string,
      bg: string,
      fg: string,
    ) {
      const b = currentBackend as {
        setColorMapping?: (
          ft: string,
          v: string,
          b: string,
          f: string,
        ) => Promise<void>;
      } | null;
      if (b?.setColorMapping) {
        await b.setColorMapping(fieldType, value, bg, fg);
        await get().reloadColorOverrides();
      }
    },

    async deleteColorMapping(fieldType: string, value: string) {
      const b = currentBackend as {
        deleteColorMapping?: (ft: string, v: string) => Promise<void>;
      } | null;
      if (b?.deleteColorMapping) {
        await b.deleteColorMapping(fieldType, value);
        await get().reloadColorOverrides();
      }
    },

    async deleteColorMappingsByField(fieldType: string) {
      const b = currentBackend as {
        deleteColorMappingsByField?: (ft: string) => Promise<void>;
      } | null;
      if (b?.deleteColorMappingsByField) {
        await b.deleteColorMappingsByField(fieldType);
        await get().reloadColorOverrides();
      }
    },

    async reloadColorOverrides() {
      const b = currentBackend as {
        getColorMappings?: () => Promise<
          { fieldType: string; value: string; bg: string; fg: string }[]
        >;
      } | null;
      if (b?.getColorMappings) {
        const mappings = await b.getColorMappings();
        themeStore.getState().loadColorOverrides(mappings);
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
      currentRemoteBackend = null;
      currentCwd = null;
      set({
        items: [],
        capabilities: { ...defaultCapabilities },
        pullRequests: [],
        prCapabilities: { ...defaultPrCapabilities },
        branches: [],
        branchesLoading: false,
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
