import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  readWorkItem,
  writeWorkItem,
  deleteWorkItem,
  listItemFiles,
} from './items.js';
import type { WorkItem } from '../../types.js';

describe('items', () => {
  let tmpDir: string;
  let itemsDirPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-test-'));
    itemsDirPath = path.join(tmpDir, '.tic', 'items');
    fs.mkdirSync(itemsDirPath, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('writes and reads a work item', () => {
    const item: WorkItem = {
      id: 1,
      title: 'Test item',
      type: 'task',
      status: 'todo',
      iteration: 'v1',
      priority: 'high',
      assignee: 'dev',
      labels: ['bug'],
      created: '2026-01-31T00:00:00Z',
      updated: '2026-01-31T00:00:00Z',
      description: 'A test item.',
      comments: [],
    };
    writeWorkItem(tmpDir, item);
    const read = readWorkItem(tmpDir, 1);
    expect(read.title).toBe('Test item');
    expect(read.type).toBe('task');
    expect(read.labels).toEqual(['bug']);
    expect(read.description).toBe('A test item.');
  });

  it('writes and reads a work item with comments', () => {
    const item: WorkItem = {
      id: 2,
      title: 'With comments',
      type: 'epic',
      status: 'todo',
      iteration: 'v1',
      priority: 'medium',
      assignee: '',
      labels: [],
      created: '2026-01-31T00:00:00Z',
      updated: '2026-01-31T00:00:00Z',
      description: 'Has comments.',
      comments: [
        { author: 'dev', date: '2026-01-31T01:00:00Z', body: 'First comment.' },
        {
          author: 'dev',
          date: '2026-01-31T02:00:00Z',
          body: 'Second comment.',
        },
      ],
    };
    writeWorkItem(tmpDir, item);
    const read = readWorkItem(tmpDir, 2);
    expect(read.comments).toHaveLength(2);
    expect(read.comments[0]!.body).toBe('First comment.');
  });

  it('deletes a work item file', () => {
    const item: WorkItem = {
      id: 3,
      title: 'To delete',
      type: 'issue',
      status: 'todo',
      iteration: 'v1',
      priority: 'low',
      assignee: '',
      labels: [],
      created: '2026-01-31T00:00:00Z',
      updated: '2026-01-31T00:00:00Z',
      description: '',
      comments: [],
    };
    writeWorkItem(tmpDir, item);
    expect(fs.existsSync(path.join(itemsDirPath, '3.md'))).toBe(true);
    deleteWorkItem(tmpDir, 3);
    expect(fs.existsSync(path.join(itemsDirPath, '3.md'))).toBe(false);
  });

  it('lists all item files', () => {
    writeWorkItem(tmpDir, {
      id: 1,
      title: 'A',
      type: 'task',
      status: 'todo',
      iteration: 'v1',
      priority: 'low',
      assignee: '',
      labels: [],
      created: '',
      updated: '',
      description: '',
      comments: [],
    });
    writeWorkItem(tmpDir, {
      id: 2,
      title: 'B',
      type: 'epic',
      status: 'todo',
      iteration: 'v1',
      priority: 'low',
      assignee: '',
      labels: [],
      created: '',
      updated: '',
      description: '',
      comments: [],
    });
    const files = listItemFiles(tmpDir);
    expect(files).toHaveLength(2);
  });
});
