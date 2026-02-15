import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Storage } from '../storage/index.js';
import { SyncManager } from './SyncManager.js';
import { SyncQueue } from '../storage/syncQueue.js';
import type { WorkItem } from '../types.js';
import { createMockRemote } from '../test-helpers.js';

describe('end-to-end sync', () => {
  let tmpDir: string;
  let local: Storage;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-e2e-'));
  });

  afterEach(() => {
    local.destroy();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('full cycle: create locally, push, pull, verify', async () => {
    local = Storage.create(tmpDir, { tempIds: true });
    const remote = createMockRemote([]);
    const queue = new SyncQueue(local.getDatabase());
    const manager = new SyncManager(local, remote, queue);

    const item = await local.createWorkItem({
      title: 'E2E Test',
      type: 'task',
      status: 'backlog',
      priority: 'medium',
      assignee: '',
      labels: [],
      iteration: 'default',
      description: 'Testing full cycle',
      parent: null,
      dependsOn: [],
    });
    expect(item.id.startsWith('local-')).toBe(true);

    queue.append({
      action: 'create',
      itemId: item.id,
      timestamp: new Date().toISOString(),
    });

    const result = await manager.sync();
    expect(result.push.pushed).toBe(1);
    expect(result.push.failed).toBe(0);

    const localItems = await local.listWorkItems();
    expect(localItems).toHaveLength(1);
    expect(localItems[0]!.id.startsWith('local-')).toBe(false);
    expect(localItems[0]!.title).toBe('E2E Test');
    expect(localItems[0]!.description).toBe('Testing full cycle');
  });

  it('remote changes overwrite local on pull', async () => {
    local = Storage.create(tmpDir);
    const queue = new SyncQueue(local.getDatabase());

    await local.createWorkItem({
      title: 'Will be overwritten',
      type: 'task',
      status: 'backlog',
      priority: 'medium',
      assignee: '',
      labels: [],
      iteration: 'default',
      description: '',
      parent: null,
      dependsOn: [],
    });

    const remoteItem: WorkItem = {
      id: '1',
      title: 'Remote Version',
      type: 'task',
      status: 'done',
      iteration: 'default',
      priority: 'high',
      assignee: 'bob',
      labels: ['urgent'],
      created: '2026-01-01T00:00:00Z',
      updated: '2026-01-01T12:00:00Z',
      description: 'From remote',
      comments: [],
      parent: null,
      dependsOn: [],
    };
    const remote = createMockRemote([remoteItem]);
    const manager = new SyncManager(local, remote, queue);

    await manager.sync();

    const item = await local.getWorkItem('1');
    expect(item.title).toBe('Remote Version');
    expect(item.status).toBe('done');
    expect(item.priority).toBe('high');
    expect(item.assignee).toBe('bob');
    expect(item.labels).toEqual(['urgent']);
    expect(item.description).toBe('From remote');
  });
});
