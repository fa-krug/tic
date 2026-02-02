// src/sync/types.test.ts
import { describe, it, expect } from 'vitest';
import type {
  QueueEntry,
  SyncQueue,
  SyncStatus,
  SyncResult,
  PushResult,
  SyncError,
} from './types.js';

describe('sync types', () => {
  it('QueueEntry has required shape', () => {
    const entry: QueueEntry = {
      action: 'create',
      itemId: 'local-abc',
      timestamp: new Date().toISOString(),
    };
    expect(entry.action).toBe('create');
    expect(entry.itemId).toBe('local-abc');
    expect(entry.timestamp).toBeDefined();
  });

  it('SyncQueue has pending array', () => {
    const queue: SyncQueue = { pending: [] };
    expect(queue.pending).toEqual([]);
  });

  it('SyncStatus has required fields', () => {
    const status: SyncStatus = {
      state: 'idle',
      pendingCount: 0,
      lastSyncTime: null,
      errors: [],
    };
    expect(status.state).toBe('idle');
  });

  it('SyncError has required fields', () => {
    const entry: QueueEntry = {
      action: 'update',
      itemId: 'item-1',
      timestamp: new Date().toISOString(),
    };
    const error: SyncError = {
      entry,
      message: 'network failure',
      timestamp: new Date().toISOString(),
    };
    expect(error.entry).toBe(entry);
    expect(error.message).toBe('network failure');
  });

  it('PushResult has required fields', () => {
    const result: PushResult = {
      pushed: 3,
      failed: 1,
      errors: [],
      idMappings: new Map([['local-1', '42']]),
    };
    expect(result.pushed).toBe(3);
    expect(result.failed).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.idMappings.get('local-1')).toBe('42');
  });

  it('SyncResult has required fields', () => {
    const result: SyncResult = {
      push: { pushed: 2, failed: 0, errors: [], idMappings: new Map() },
      pullCount: 5,
    };
    expect(result.push.pushed).toBe(2);
    expect(result.pullCount).toBe(5);
  });
});
