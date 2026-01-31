import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LocalBackend } from '../../backends/local/index.js';
import type { WorkItem } from '../../types.js';
import {
  handleInitProject,
  handleGetConfig,
  handleListItems,
  handleShowItem,
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
        alreadyExists: boolean;
      };
      expect(data.alreadyExists).toBe(false);
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
      const result = handleGetConfig(backend);
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text) as {
        statuses: string[];
        types: string[];
        iterations: string[];
        currentIteration: string;
      };
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
});
