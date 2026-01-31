import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LocalBackend } from '../../backends/local/index.js';
import type { WorkItem, Comment } from '../../types.js';
import {
  handleInitProject,
  handleGetConfig,
  handleListItems,
  handleShowItem,
  handleCreateItem,
  handleUpdateItem,
  handleDeleteItem,
  handleConfirmDelete,
  createDeleteTracker,
  handleAddComment,
  handleSetIteration,
  handleSearchItems,
  handleGetChildren,
  handleGetDependents,
  handleGetItemTree,
} from '../commands/mcp.js';

describe('MCP handlers', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-mcp-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  let backend: LocalBackend;

  describe('handleInitProject', () => {
    it('initializes a new project', () => {
      const result = handleInitProject(tmpDir);
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text) as {
        initialized?: boolean;
        alreadyExists?: boolean;
      };
      expect(data.initialized).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.tic', 'config.yml'))).toBe(true);
    });

    it('returns alreadyExists for existing project', () => {
      handleInitProject(tmpDir);
      const result = handleInitProject(tmpDir);
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text) as {
        alreadyExists: boolean;
      };
      expect(data.alreadyExists).toBe(true);
    });
  });

  describe('handleGetConfig', () => {
    it('returns config from backend', () => {
      handleInitProject(tmpDir);
      backend = new LocalBackend(tmpDir);
      const result = handleGetConfig(backend, tmpDir);
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text) as {
        backend: string;
        statuses: string[];
        types: string[];
        iterations: string[];
        currentIteration: string;
      };
      expect(data.backend).toBe('local');
      expect(data.statuses).toEqual([
        'backlog',
        'todo',
        'in-progress',
        'review',
        'done',
      ]);
      expect(data.types).toEqual(['epic', 'issue', 'task']);
      expect(data.iterations).toEqual(['default']);
      expect(data.currentIteration).toBe('default');
    });
  });

  describe('handleListItems', () => {
    beforeEach(() => {
      handleInitProject(tmpDir);
      backend = new LocalBackend(tmpDir);
    });

    it('lists items', () => {
      backend.createWorkItem({
        title: 'Item A',
        type: 'task',
        status: 'backlog',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: 'default',
        parent: null,
        dependsOn: [],
        description: '',
      });
      backend.createWorkItem({
        title: 'Item B',
        type: 'task',
        status: 'backlog',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: 'default',
        parent: null,
        dependsOn: [],
        description: '',
      });
      const result = handleListItems(backend, {});
      const data = JSON.parse(result.content[0]!.text) as WorkItem[];
      expect(data).toHaveLength(2);
    });

    it('filters by type', () => {
      backend.createWorkItem({
        title: 'Epic A',
        type: 'epic',
        status: 'backlog',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: 'default',
        parent: null,
        dependsOn: [],
        description: '',
      });
      backend.createWorkItem({
        title: 'Task A',
        type: 'task',
        status: 'backlog',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: 'default',
        parent: null,
        dependsOn: [],
        description: '',
      });
      const result = handleListItems(backend, { type: 'epic' });
      const data = JSON.parse(result.content[0]!.text) as WorkItem[];
      expect(data).toHaveLength(1);
      expect(data[0]!.title).toBe('Epic A');
    });

    it('filters by status', () => {
      backend.createWorkItem({
        title: 'Todo item',
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
      backend.createWorkItem({
        title: 'Done item',
        type: 'task',
        status: 'done',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: 'default',
        parent: null,
        dependsOn: [],
        description: '',
      });
      const result = handleListItems(backend, { status: 'todo' });
      const data = JSON.parse(result.content[0]!.text) as WorkItem[];
      expect(data).toHaveLength(1);
      expect(data[0]!.title).toBe('Todo item');
    });
  });

  describe('handleShowItem', () => {
    beforeEach(() => {
      handleInitProject(tmpDir);
      backend = new LocalBackend(tmpDir);
    });

    it('returns item details', () => {
      backend.createWorkItem({
        title: 'Show me',
        type: 'task',
        status: 'backlog',
        priority: 'high',
        assignee: 'alice',
        labels: ['bug'],
        iteration: 'default',
        parent: null,
        dependsOn: [],
        description: 'Details here',
      });
      const result = handleShowItem(backend, { id: 1 });
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text) as WorkItem;
      expect(data.title).toBe('Show me');
      expect(data.priority).toBe('high');
      expect(data.description).toBe('Details here');
    });

    it('returns error for non-existent item', () => {
      const result = handleShowItem(backend, { id: 999 });
      expect(result.isError).toBe(true);
    });
  });

  describe('handleCreateItem', () => {
    beforeEach(() => {
      handleInitProject(tmpDir);
      backend = new LocalBackend(tmpDir);
    });

    it('creates with defaults', () => {
      const result = handleCreateItem(backend, { title: 'New task' });
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text) as WorkItem;
      expect(data.title).toBe('New task');
      expect(data.type).toBe('task');
      expect(data.status).toBe('backlog');
      expect(data.priority).toBe('medium');
      expect(data.id).toBe(1);
    });

    it('creates with all options', () => {
      const result = handleCreateItem(backend, {
        title: 'Full item',
        type: 'epic',
        status: 'todo',
        priority: 'high',
        assignee: 'bob',
        labels: 'ui,frontend',
        iteration: 'sprint-1',
        description: 'A full item',
      });
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text) as WorkItem;
      expect(data.type).toBe('epic');
      expect(data.status).toBe('todo');
      expect(data.priority).toBe('high');
      expect(data.assignee).toBe('bob');
      expect(data.labels).toEqual(['ui', 'frontend']);
      expect(data.iteration).toBe('sprint-1');
      expect(data.description).toBe('A full item');
    });
  });

  describe('handleUpdateItem', () => {
    beforeEach(() => {
      handleInitProject(tmpDir);
      backend = new LocalBackend(tmpDir);
    });

    it('updates fields', () => {
      backend.createWorkItem({
        title: 'Original',
        type: 'task',
        status: 'backlog',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: 'default',
        parent: null,
        dependsOn: [],
        description: '',
      });
      const result = handleUpdateItem(backend, {
        id: 1,
        title: 'Updated',
        status: 'done',
      });
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text) as WorkItem;
      expect(data.title).toBe('Updated');
      expect(data.status).toBe('done');
      expect(data.type).toBe('task');
    });

    it('returns error for non-existent item', () => {
      const result = handleUpdateItem(backend, {
        id: 999,
        title: 'Nope',
      });
      expect(result.isError).toBe(true);
    });
  });

  describe('handleDeleteItem', () => {
    let pendingDeletes: Set<number>;

    beforeEach(() => {
      handleInitProject(tmpDir);
      backend = new LocalBackend(tmpDir);
      pendingDeletes = createDeleteTracker();
    });

    it('returns preview without deleting', () => {
      backend.createWorkItem({
        title: 'Delete me',
        type: 'task',
        status: 'backlog',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: 'default',
        parent: null,
        dependsOn: [],
        description: '',
      });
      const result = handleDeleteItem(backend, { id: 1 }, pendingDeletes);
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text) as {
        preview: boolean;
        item: { id: number; title: string; type: string; status: string };
        affectedChildren: { id: number; title: string }[];
        affectedDependents: { id: number; title: string }[];
        message: string;
      };
      expect(data.preview).toBe(true);
      expect(data.item.title).toBe('Delete me');
      // Item should still exist
      expect(backend.getWorkItem(1).title).toBe('Delete me');
    });

    it('shows affected children and dependents', () => {
      backend.createWorkItem({
        title: 'Parent',
        type: 'task',
        status: 'backlog',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: 'default',
        parent: null,
        dependsOn: [],
        description: '',
      });
      backend.createWorkItem({
        title: 'Child',
        type: 'task',
        status: 'backlog',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: 'default',
        parent: 1,
        dependsOn: [],
        description: '',
      });
      backend.createWorkItem({
        title: 'Dependent',
        type: 'task',
        status: 'backlog',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: 'default',
        parent: null,
        dependsOn: [1],
        description: '',
      });
      const result = handleDeleteItem(backend, { id: 1 }, pendingDeletes);
      const data = JSON.parse(result.content[0]!.text) as {
        preview: boolean;
        item: { id: number; title: string; type: string; status: string };
        affectedChildren: { id: number; title: string }[];
        affectedDependents: { id: number; title: string }[];
        message: string;
      };
      expect(data.preview).toBe(true);
      expect(data.affectedChildren).toHaveLength(1);
      expect(data.affectedChildren[0]!).toEqual({ id: 2, title: 'Child' });
      expect(data.affectedDependents).toHaveLength(1);
      expect(data.affectedDependents[0]!).toEqual({
        id: 3,
        title: 'Dependent',
      });
    });
  });

  describe('handleConfirmDelete', () => {
    let pendingDeletes: Set<number>;

    beforeEach(() => {
      handleInitProject(tmpDir);
      backend = new LocalBackend(tmpDir);
      pendingDeletes = createDeleteTracker();
    });

    it('works after preview', () => {
      backend.createWorkItem({
        title: 'Delete me',
        type: 'task',
        status: 'backlog',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: 'default',
        parent: null,
        dependsOn: [],
        description: '',
      });
      handleDeleteItem(backend, { id: 1 }, pendingDeletes);
      const result = handleConfirmDelete(backend, { id: 1 }, pendingDeletes);
      expect(result.isError).toBeUndefined();
      expect(() => backend.getWorkItem(1)).toThrow();
    });

    it('rejects without preview', () => {
      backend.createWorkItem({
        title: 'No preview',
        type: 'task',
        status: 'backlog',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: 'default',
        parent: null,
        dependsOn: [],
        description: '',
      });
      const result = handleConfirmDelete(backend, { id: 1 }, pendingDeletes);
      expect(result.isError).toBe(true);
      // Item should still exist
      expect(backend.getWorkItem(1).title).toBe('No preview');
    });

    it('rejects second call', () => {
      backend.createWorkItem({
        title: 'Once only',
        type: 'task',
        status: 'backlog',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: 'default',
        parent: null,
        dependsOn: [],
        description: '',
      });
      handleDeleteItem(backend, { id: 1 }, pendingDeletes);
      handleConfirmDelete(backend, { id: 1 }, pendingDeletes);
      const result = handleConfirmDelete(backend, { id: 1 }, pendingDeletes);
      expect(result.isError).toBe(true);
    });
  });

  describe('handleAddComment', () => {
    beforeEach(() => {
      handleInitProject(tmpDir);
      backend = new LocalBackend(tmpDir);
    });

    it('adds comment to item', () => {
      backend.createWorkItem({
        title: 'Commentable',
        type: 'task',
        status: 'backlog',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: 'default',
        parent: null,
        dependsOn: [],
        description: '',
      });
      const result = handleAddComment(backend, {
        id: 1,
        text: 'Great work',
        author: 'alice',
      });
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text) as Comment;
      expect(data.body).toBe('Great work');
      expect(data.author).toBe('alice');
    });

    it('defaults author to anonymous', () => {
      backend.createWorkItem({
        title: 'Commentable',
        type: 'task',
        status: 'backlog',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: 'default',
        parent: null,
        dependsOn: [],
        description: '',
      });
      const result = handleAddComment(backend, {
        id: 1,
        text: 'Anonymous note',
      });
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text) as Comment;
      expect(data.author).toBe('anonymous');
    });

    it('returns error for non-existent item', () => {
      const result = handleAddComment(backend, {
        id: 999,
        text: 'Nope',
      });
      expect(result.isError).toBe(true);
    });
  });

  describe('handleSetIteration', () => {
    beforeEach(() => {
      handleInitProject(tmpDir);
      backend = new LocalBackend(tmpDir);
    });

    it('sets current iteration', () => {
      const result = handleSetIteration(backend, { name: 'sprint-2' });
      expect(result.isError).toBeUndefined();
      expect(backend.getCurrentIteration()).toBe('sprint-2');
    });
  });

  describe('handleSearchItems', () => {
    beforeEach(() => {
      handleInitProject(tmpDir);
      backend = new LocalBackend(tmpDir);
      backend.createWorkItem({
        title: 'Fix login bug',
        type: 'issue',
        status: 'todo',
        priority: 'high',
        assignee: '',
        labels: [],
        iteration: 'default',
        parent: null,
        dependsOn: [],
        description: 'The login page crashes on submit',
      });
      backend.createWorkItem({
        title: 'Add dashboard',
        type: 'task',
        status: 'backlog',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: 'default',
        parent: null,
        dependsOn: [],
        description: 'Create a new dashboard view',
      });
      backend.createWorkItem({
        title: 'Update login styles',
        type: 'task',
        status: 'done',
        priority: 'low',
        assignee: '',
        labels: [],
        iteration: 'default',
        parent: null,
        dependsOn: [],
        description: 'Modernize the CSS',
      });
    });

    it('finds by title', () => {
      const result = handleSearchItems(backend, { query: 'login' });
      const data = JSON.parse(result.content[0]!.text) as WorkItem[];
      expect(data).toHaveLength(2);
      expect(data.map((i) => i.title)).toContain('Fix login bug');
      expect(data.map((i) => i.title)).toContain('Update login styles');
    });

    it('finds by description', () => {
      const result = handleSearchItems(backend, { query: 'dashboard' });
      const data = JSON.parse(result.content[0]!.text) as WorkItem[];
      expect(data).toHaveLength(1);
      expect(data[0]!.title).toBe('Add dashboard');
    });

    it('is case-insensitive', () => {
      const result = handleSearchItems(backend, { query: 'LOGIN' });
      const data = JSON.parse(result.content[0]!.text) as WorkItem[];
      expect(data).toHaveLength(2);
    });

    it('returns empty array for no results', () => {
      const result = handleSearchItems(backend, { query: 'nonexistent' });
      const data = JSON.parse(result.content[0]!.text) as WorkItem[];
      expect(data).toHaveLength(0);
    });

    it('combines with filters', () => {
      const result = handleSearchItems(backend, {
        query: 'login',
        status: 'todo',
      });
      const data = JSON.parse(result.content[0]!.text) as WorkItem[];
      expect(data).toHaveLength(1);
      expect(data[0]!.title).toBe('Fix login bug');
    });
  });

  describe('handleGetChildren', () => {
    beforeEach(() => {
      handleInitProject(tmpDir);
      backend = new LocalBackend(tmpDir);
    });

    it('returns children', () => {
      backend.createWorkItem({
        title: 'Parent',
        type: 'epic',
        status: 'backlog',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: 'default',
        parent: null,
        dependsOn: [],
        description: '',
      });
      backend.createWorkItem({
        title: 'Child 1',
        type: 'task',
        status: 'backlog',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: 'default',
        parent: 1,
        dependsOn: [],
        description: '',
      });
      backend.createWorkItem({
        title: 'Child 2',
        type: 'task',
        status: 'backlog',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: 'default',
        parent: 1,
        dependsOn: [],
        description: '',
      });
      const result = handleGetChildren(backend, { id: 1 });
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text) as WorkItem[];
      expect(data).toHaveLength(2);
      expect(data.map((i) => i.title)).toContain('Child 1');
      expect(data.map((i) => i.title)).toContain('Child 2');
    });
  });

  describe('handleGetDependents', () => {
    beforeEach(() => {
      handleInitProject(tmpDir);
      backend = new LocalBackend(tmpDir);
    });

    it('returns dependents', () => {
      backend.createWorkItem({
        title: 'Dependency',
        type: 'task',
        status: 'backlog',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: 'default',
        parent: null,
        dependsOn: [],
        description: '',
      });
      backend.createWorkItem({
        title: 'Dependent',
        type: 'task',
        status: 'backlog',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: 'default',
        parent: null,
        dependsOn: [1],
        description: '',
      });
      const result = handleGetDependents(backend, { id: 1 });
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text) as WorkItem[];
      expect(data).toHaveLength(1);
      expect(data[0]!.title).toBe('Dependent');
    });
  });

  describe('handleGetItemTree', () => {
    interface TreeNode {
      id: number;
      title: string;
      type: string;
      status: string;
      priority: string;
      iteration: string;
      children: TreeNode[];
    }

    beforeEach(() => {
      handleInitProject(tmpDir);
      backend = new LocalBackend(tmpDir);
    });

    it('returns items nested under parents', () => {
      backend.createWorkItem({
        title: 'Epic',
        type: 'epic',
        status: 'backlog',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: 'default',
        parent: null,
        dependsOn: [],
        description: '',
      });
      backend.createWorkItem({
        title: 'Child A',
        type: 'task',
        status: 'todo',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: 'default',
        parent: 1,
        dependsOn: [],
        description: '',
      });
      backend.createWorkItem({
        title: 'Standalone',
        type: 'task',
        status: 'backlog',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: 'default',
        parent: null,
        dependsOn: [],
        description: '',
      });
      const result = handleGetItemTree(backend, {});
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text) as TreeNode[];
      expect(data).toHaveLength(2);
      const epic = data.find((n) => n.title === 'Epic')!;
      expect(epic.children).toHaveLength(1);
      expect(epic.children[0]!.title).toBe('Child A');
      const standalone = data.find((n) => n.title === 'Standalone')!;
      expect(standalone.children).toHaveLength(0);
    });

    it('builds deeply nested tree', () => {
      backend.createWorkItem({
        title: 'Root',
        type: 'epic',
        status: 'backlog',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: 'default',
        parent: null,
        dependsOn: [],
        description: '',
      });
      backend.createWorkItem({
        title: 'Level 1',
        type: 'issue',
        status: 'backlog',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: 'default',
        parent: 1,
        dependsOn: [],
        description: '',
      });
      backend.createWorkItem({
        title: 'Level 2',
        type: 'task',
        status: 'backlog',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: 'default',
        parent: 2,
        dependsOn: [],
        description: '',
      });
      const result = handleGetItemTree(backend, {});
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text) as TreeNode[];
      expect(data).toHaveLength(1);
      expect(data[0]!.title).toBe('Root');
      expect(data[0]!.children).toHaveLength(1);
      expect(data[0]!.children[0]!.title).toBe('Level 1');
      expect(data[0]!.children[0]!.children).toHaveLength(1);
      expect(data[0]!.children[0]!.children[0]!.title).toBe('Level 2');
    });
  });
});
