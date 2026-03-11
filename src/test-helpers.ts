/**
 * Shared test factories and mock backends.
 * Import from './test-helpers.js' in any test file.
 */
import { vi } from 'vitest';
import type {
  WorkItem,
  NewWorkItem,
  NewComment,
  Comment,
  PullRequest,
  Template,
  Iteration,
} from './types.js';
import type { Backend } from './backends/types.js';

export function makeWorkItem(
  rowId: number,
  overrides: Partial<WorkItem> = {},
): WorkItem {
  return {
    rowId,
    id: String(rowId),
    title: `Item ${rowId}`,
    type: 'task',
    status: 'todo',
    priority: 'medium',
    assignee: '',
    labels: [],
    parent: null,
    dependsOn: [],
    iteration: '',
    description: '',
    comments: [],
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

export function makeNewWorkItem(
  overrides: Partial<NewWorkItem> = {},
): NewWorkItem {
  return {
    title: 'Test item',
    type: 'task',
    status: 'todo',
    iteration: 'default',
    priority: 'medium',
    assignee: '',
    labels: [],
    description: '',
    parent: null,
    dependsOn: [],
    ...overrides,
  };
}

export function makePullRequest(
  overrides: Partial<PullRequest> = {},
): PullRequest {
  return {
    id: 'pr-1',
    number: 1,
    title: 'Test PR',
    description: 'A test pull request',
    status: 'open',
    sourceBranch: 'feature/test',
    targetBranch: 'main',
    author: 'testuser',
    linkedItems: [],
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
    url: 'https://github.com/test/repo/pull/1',
    ...overrides,
  };
}

export function makeTemplate(overrides: Partial<Template> = {}): Template {
  return {
    slug: '',
    name: 'Test Template',
    type: 'task',
    status: 'todo',
    priority: 'medium',
    assignee: '',
    labels: [],
    iteration: '',
    parent: null,
    dependsOn: [],
    description: '',
    ...overrides,
  };
}

export function createMockRemote(items: WorkItem[] = []): Backend {
  const store = new Map(items.map((i) => [i.id, i]));
  let nextRowId = 100;
  /* eslint-disable @typescript-eslint/require-await */
  return {
    getCapabilities: () => ({
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
      templates: false,
      imageUpload: false,
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
    }),
    getStatuses: async () => ['backlog', 'todo', 'in-progress', 'done'],
    getClosedStatuses: async () => ['done'],
    getIterations: async (): Promise<Iteration[]> => [
      { name: 'default', startDate: null, endDate: null },
    ],
    getWorkItemTypes: async () => ['epic', 'issue', 'task'],
    getAssignees: async () => [],
    getLabels: async () => [],
    getCurrentIteration: async () => 'default',
    setCurrentIteration: vi.fn(async () => {}),
    listWorkItems: async () => [...store.values()],
    getWorkItem: async (id: string) => {
      const item = store.get(id);
      if (!item) throw new Error(`Item #${id} not found`);
      return item;
    },
    createWorkItem: async (data: NewWorkItem) => {
      const rowId = nextRowId++;
      const id = String(rowId);
      const item: WorkItem = {
        ...data,
        rowId,
        id,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        comments: [],
      };
      store.set(id, item);
      return item;
    },
    updateWorkItem: async (id: string, data: Partial<WorkItem>) => {
      const existing = store.get(id);
      if (!existing) throw new Error(`Item #${id} not found`);
      const updated = {
        ...existing,
        ...data,
        id,
        updated: new Date().toISOString(),
      };
      store.set(id, updated);
      return updated;
    },
    deleteWorkItem: async (id: string) => {
      store.delete(id);
    },
    addComment: async (workItemId: string, comment: NewComment) => {
      const item = store.get(workItemId);
      if (!item) throw new Error(`Item #${workItemId} not found`);
      const c: Comment = {
        author: comment.author,
        date: new Date().toISOString(),
        body: comment.body,
      };
      item.comments.push(c);
      return c;
    },
    getChildren: async () => [],
    getDependents: async () => [],
    cachedCreateWorkItem: async (data: NewWorkItem) => {
      const rowId = nextRowId++;
      const id = String(rowId);
      const item: WorkItem = {
        ...data,
        rowId,
        id,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        comments: [],
      };
      store.set(id, item);
      return item;
    },
    cachedUpdateWorkItem: async (id: string, data: Partial<WorkItem>) => {
      const existing = store.get(id);
      if (!existing) throw new Error(`Item #${id} not found`);
      const updated = {
        ...existing,
        ...data,
        id,
        updated: new Date().toISOString(),
      };
      store.set(id, updated);
      return updated;
    },
    cachedDeleteWorkItem: async (id: string) => {
      store.delete(id);
    },
    getItemUrl: (id: string) => `https://remote/${id}`,
    openItem: vi.fn(async () => {}),
    listTemplates: async () => [],
    getTemplate: async () => {
      throw new Error('not supported');
    },
    createTemplate: async () => {
      throw new Error('not supported');
    },
    updateTemplate: async () => {
      throw new Error('not supported');
    },
    deleteTemplate: async () => {
      throw new Error('not supported');
    },
  };
  /* eslint-enable @typescript-eslint/require-await */
}
