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
    it('initializes a new project', async () => {
      const result = await handleInitProject(tmpDir);
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text) as {
        initialized?: boolean;
        alreadyExists?: boolean;
      };
      expect(data.initialized).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.tic', 'config.yml'))).toBe(true);
    });

    it('returns alreadyExists for existing project', async () => {
      await handleInitProject(tmpDir);
      const result = await handleInitProject(tmpDir);
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text) as {
        alreadyExists: boolean;
      };
      expect(data.alreadyExists).toBe(true);
    });
  });

  describe('handleGetConfig', () => {
    it('returns config from backend', async () => {
      await handleInitProject(tmpDir);
      backend = await LocalBackend.create(tmpDir);
      const result = await handleGetConfig(backend, tmpDir);
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
    beforeEach(async () => {
      await handleInitProject(tmpDir);
      backend = await LocalBackend.create(tmpDir);
    });

    it('lists items', async () => {
      await backend.createWorkItem({
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
      await backend.createWorkItem({
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
      const result = await handleListItems(backend, {});
      const data = JSON.parse(result.content[0]!.text) as WorkItem[];
      expect(data).toHaveLength(2);
    });

    it('filters by type', async () => {
      await backend.createWorkItem({
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
      await backend.createWorkItem({
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
      const result = await handleListItems(backend, { type: 'epic' });
      const data = JSON.parse(result.content[0]!.text) as WorkItem[];
      expect(data).toHaveLength(1);
      expect(data[0]!.title).toBe('Epic A');
    });

    it('filters by status', async () => {
      await backend.createWorkItem({
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
      await backend.createWorkItem({
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
      const result = await handleListItems(backend, { status: 'todo' });
      const data = JSON.parse(result.content[0]!.text) as WorkItem[];
      expect(data).toHaveLength(1);
      expect(data[0]!.title).toBe('Todo item');
    });
  });

  describe('handleShowItem', () => {
    beforeEach(async () => {
      await handleInitProject(tmpDir);
      backend = await LocalBackend.create(tmpDir);
    });

    it('returns item details', async () => {
      await backend.createWorkItem({
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
      const result = await handleShowItem(backend, { id: '1' });
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text) as WorkItem;
      expect(data.title).toBe('Show me');
      expect(data.priority).toBe('high');
      expect(data.description).toBe('Details here');
    });

    it('returns error for non-existent item', async () => {
      const result = await handleShowItem(backend, { id: '999' });
      expect(result.isError).toBe(true);
    });
  });

  describe('handleCreateItem', () => {
    beforeEach(async () => {
      await handleInitProject(tmpDir);
      backend = await LocalBackend.create(tmpDir);
    });

    it('creates with defaults', async () => {
      const result = await handleCreateItem(backend, { title: 'New task' });
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text) as WorkItem;
      expect(data.title).toBe('New task');
      expect(data.type).toBe('task');
      expect(data.status).toBe('backlog');
      expect(data.priority).toBe('medium');
      expect(data.id).toBe('1');
    });

    it('creates with all options', async () => {
      const result = await handleCreateItem(backend, {
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
    beforeEach(async () => {
      await handleInitProject(tmpDir);
      backend = await LocalBackend.create(tmpDir);
    });

    it('updates fields', async () => {
      await backend.createWorkItem({
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
      const result = await handleUpdateItem(backend, {
        id: '1',
        title: 'Updated',
        status: 'done',
      });
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text) as WorkItem;
      expect(data.title).toBe('Updated');
      expect(data.status).toBe('done');
      expect(data.type).toBe('task');
    });

    it('returns error for non-existent item', async () => {
      const result = await handleUpdateItem(backend, {
        id: '999',
        title: 'Nope',
      });
      expect(result.isError).toBe(true);
    });
  });

  describe('handleDeleteItem', () => {
    let pendingDeletes: Set<string>;

    beforeEach(async () => {
      await handleInitProject(tmpDir);
      backend = await LocalBackend.create(tmpDir);
      pendingDeletes = createDeleteTracker();
    });

    it('returns preview without deleting', async () => {
      await backend.createWorkItem({
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
      const result = await handleDeleteItem(
        backend,
        { id: '1' },
        pendingDeletes,
      );
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text) as {
        preview: boolean;
        item: { id: string; title: string; type: string; status: string };
        affectedChildren: { id: string; title: string }[];
        affectedDependents: { id: string; title: string }[];
        message: string;
      };
      expect(data.preview).toBe(true);
      expect(data.item.title).toBe('Delete me');
      // Item should still exist
      expect((await backend.getWorkItem('1')).title).toBe('Delete me');
    });

    it('shows affected children and dependents', async () => {
      await backend.createWorkItem({
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
      await backend.createWorkItem({
        title: 'Child',
        type: 'task',
        status: 'backlog',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: 'default',
        parent: '1',
        dependsOn: [],
        description: '',
      });
      await backend.createWorkItem({
        title: 'Dependent',
        type: 'task',
        status: 'backlog',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: 'default',
        parent: null,
        dependsOn: ['1'],
        description: '',
      });
      const result = await handleDeleteItem(
        backend,
        { id: '1' },
        pendingDeletes,
      );
      const data = JSON.parse(result.content[0]!.text) as {
        preview: boolean;
        item: { id: string; title: string; type: string; status: string };
        affectedChildren: { id: string; title: string }[];
        affectedDependents: { id: string; title: string }[];
        message: string;
      };
      expect(data.preview).toBe(true);
      expect(data.affectedChildren).toHaveLength(1);
      expect(data.affectedChildren[0]!).toEqual({ id: '2', title: 'Child' });
      expect(data.affectedDependents).toHaveLength(1);
      expect(data.affectedDependents[0]!).toEqual({
        id: '3',
        title: 'Dependent',
      });
    });
  });

  describe('handleConfirmDelete', () => {
    let pendingDeletes: Set<string>;

    beforeEach(async () => {
      await handleInitProject(tmpDir);
      backend = await LocalBackend.create(tmpDir);
      pendingDeletes = createDeleteTracker();
    });

    it('works after preview', async () => {
      await backend.createWorkItem({
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
      await handleDeleteItem(backend, { id: '1' }, pendingDeletes);
      const result = await handleConfirmDelete(
        backend,
        { id: '1' },
        pendingDeletes,
      );
      expect(result.isError).toBeUndefined();
      await expect(backend.getWorkItem('1')).rejects.toThrow();
    });

    it('rejects without preview', async () => {
      await backend.createWorkItem({
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
      const result = await handleConfirmDelete(
        backend,
        { id: '1' },
        pendingDeletes,
      );
      expect(result.isError).toBe(true);
      // Item should still exist
      expect((await backend.getWorkItem('1')).title).toBe('No preview');
    });

    it('rejects second call', async () => {
      await backend.createWorkItem({
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
      await handleDeleteItem(backend, { id: '1' }, pendingDeletes);
      await handleConfirmDelete(backend, { id: '1' }, pendingDeletes);
      const result = await handleConfirmDelete(
        backend,
        { id: '1' },
        pendingDeletes,
      );
      expect(result.isError).toBe(true);
    });
  });

  describe('handleAddComment', () => {
    beforeEach(async () => {
      await handleInitProject(tmpDir);
      backend = await LocalBackend.create(tmpDir);
    });

    it('adds comment to item', async () => {
      await backend.createWorkItem({
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
      const result = await handleAddComment(backend, {
        id: '1',
        text: 'Great work',
        author: 'alice',
      });
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text) as Comment;
      expect(data.body).toBe('Great work');
      expect(data.author).toBe('alice');
    });

    it('defaults author to anonymous', async () => {
      await backend.createWorkItem({
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
      const result = await handleAddComment(backend, {
        id: '1',
        text: 'Anonymous note',
      });
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text) as Comment;
      expect(data.author).toBe('anonymous');
    });

    it('returns error for non-existent item', async () => {
      const result = await handleAddComment(backend, {
        id: '999',
        text: 'Nope',
      });
      expect(result.isError).toBe(true);
    });
  });

  describe('handleSetIteration', () => {
    beforeEach(async () => {
      await handleInitProject(tmpDir);
      backend = await LocalBackend.create(tmpDir);
    });

    it('sets current iteration', async () => {
      const result = await handleSetIteration(backend, { name: 'sprint-2' });
      expect(result.isError).toBeUndefined();
      expect(await backend.getCurrentIteration()).toBe('sprint-2');
    });
  });

  describe('handleSearchItems', () => {
    beforeEach(async () => {
      await handleInitProject(tmpDir);
      backend = await LocalBackend.create(tmpDir);
      await backend.createWorkItem({
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
      await backend.createWorkItem({
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
      await backend.createWorkItem({
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

    it('finds by title', async () => {
      const result = await handleSearchItems(backend, { query: 'login' });
      const data = JSON.parse(result.content[0]!.text) as WorkItem[];
      expect(data).toHaveLength(2);
      expect(data.map((i) => i.title)).toContain('Fix login bug');
      expect(data.map((i) => i.title)).toContain('Update login styles');
    });

    it('finds by description', async () => {
      const result = await handleSearchItems(backend, { query: 'dashboard' });
      const data = JSON.parse(result.content[0]!.text) as WorkItem[];
      expect(data).toHaveLength(1);
      expect(data[0]!.title).toBe('Add dashboard');
    });

    it('is case-insensitive', async () => {
      const result = await handleSearchItems(backend, { query: 'LOGIN' });
      const data = JSON.parse(result.content[0]!.text) as WorkItem[];
      expect(data).toHaveLength(2);
    });

    it('returns empty array for no results', async () => {
      const result = await handleSearchItems(backend, { query: 'nonexistent' });
      const data = JSON.parse(result.content[0]!.text) as WorkItem[];
      expect(data).toHaveLength(0);
    });

    it('combines with filters', async () => {
      const result = await handleSearchItems(backend, {
        query: 'login',
        status: 'todo',
      });
      const data = JSON.parse(result.content[0]!.text) as WorkItem[];
      expect(data).toHaveLength(1);
      expect(data[0]!.title).toBe('Fix login bug');
    });
  });

  describe('handleGetChildren', () => {
    beforeEach(async () => {
      await handleInitProject(tmpDir);
      backend = await LocalBackend.create(tmpDir);
    });

    it('returns children', async () => {
      await backend.createWorkItem({
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
      await backend.createWorkItem({
        title: 'Child 1',
        type: 'task',
        status: 'backlog',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: 'default',
        parent: '1',
        dependsOn: [],
        description: '',
      });
      await backend.createWorkItem({
        title: 'Child 2',
        type: 'task',
        status: 'backlog',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: 'default',
        parent: '1',
        dependsOn: [],
        description: '',
      });
      const result = await handleGetChildren(backend, { id: '1' });
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text) as WorkItem[];
      expect(data).toHaveLength(2);
      expect(data.map((i) => i.title)).toContain('Child 1');
      expect(data.map((i) => i.title)).toContain('Child 2');
    });
  });

  describe('handleGetDependents', () => {
    beforeEach(async () => {
      await handleInitProject(tmpDir);
      backend = await LocalBackend.create(tmpDir);
    });

    it('returns dependents', async () => {
      await backend.createWorkItem({
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
      await backend.createWorkItem({
        title: 'Dependent',
        type: 'task',
        status: 'backlog',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: 'default',
        parent: null,
        dependsOn: ['1'],
        description: '',
      });
      const result = await handleGetDependents(backend, { id: '1' });
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text) as WorkItem[];
      expect(data).toHaveLength(1);
      expect(data[0]!.title).toBe('Dependent');
    });
  });

  describe('handleGetItemTree', () => {
    interface TreeNode {
      id: string;
      title: string;
      type: string;
      status: string;
      priority: string;
      iteration: string;
      children: TreeNode[];
    }

    beforeEach(async () => {
      await handleInitProject(tmpDir);
      backend = await LocalBackend.create(tmpDir);
    });

    it('returns items nested under parents', async () => {
      await backend.createWorkItem({
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
      await backend.createWorkItem({
        title: 'Child A',
        type: 'task',
        status: 'todo',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: 'default',
        parent: '1',
        dependsOn: [],
        description: '',
      });
      await backend.createWorkItem({
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
      const result = await handleGetItemTree(backend, {});
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text) as TreeNode[];
      expect(data).toHaveLength(2);
      const epic = data.find((n) => n.title === 'Epic')!;
      expect(epic.children).toHaveLength(1);
      expect(epic.children[0]!.title).toBe('Child A');
      const standalone = data.find((n) => n.title === 'Standalone')!;
      expect(standalone.children).toHaveLength(0);
    });

    it('builds deeply nested tree', async () => {
      await backend.createWorkItem({
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
      await backend.createWorkItem({
        title: 'Level 1',
        type: 'issue',
        status: 'backlog',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: 'default',
        parent: '1',
        dependsOn: [],
        description: '',
      });
      await backend.createWorkItem({
        title: 'Level 2',
        type: 'task',
        status: 'backlog',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: 'default',
        parent: '2',
        dependsOn: [],
        description: '',
      });
      const result = await handleGetItemTree(backend, {});
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
