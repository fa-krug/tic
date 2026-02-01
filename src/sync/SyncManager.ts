import type { Backend } from '../backends/types.js';
import { LocalBackend } from '../backends/local/index.js';
import type { SyncQueueStore } from './queue.js';
import type {
  QueueEntry,
  SyncStatus,
  SyncResult,
  PushResult,
  SyncError,
} from './types.js';
import {
  writeWorkItem,
  deleteWorkItem as removeWorkItemFile,
} from '../backends/local/items.js';

type StatusListener = (status: SyncStatus) => void;

export class SyncManager {
  private local: LocalBackend;
  private remote: Backend;
  private queue: SyncQueueStore;
  private status: SyncStatus;
  private listeners: StatusListener[] = [];

  constructor(local: LocalBackend, remote: Backend, queue: SyncQueueStore) {
    this.local = local;
    this.remote = remote;
    this.queue = queue;
    this.status = {
      state: 'idle',
      pendingCount: queue.read().pending.length,
      lastSyncTime: null,
      errors: [],
    };
  }

  getStatus(): SyncStatus {
    return { ...this.status };
  }

  onStatusChange(cb: StatusListener): void {
    this.listeners.push(cb);
  }

  private updateStatus(partial: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...partial };
    for (const cb of this.listeners) {
      cb(this.getStatus());
    }
  }

  async pushPending(): Promise<PushResult> {
    const { pending } = this.queue.read();
    let pushed = 0;
    const errors: SyncError[] = [];

    for (const entry of pending) {
      try {
        const resolvedId = await this.pushEntry(entry);
        this.queue.remove(resolvedId, entry.action);
        pushed++;
      } catch (e) {
        const isLocalMissing =
          e instanceof Error &&
          'code' in e &&
          (e as NodeJS.ErrnoException).code === 'ENOENT';
        if (isLocalMissing) {
          // Local item was deleted or never synced — drop unrecoverable entry
          this.queue.remove(entry.itemId, entry.action);
        } else {
          errors.push({
            entry,
            message: e instanceof Error ? e.message : String(e),
            timestamp: new Date().toISOString(),
          });
        }
      }
    }

    this.updateStatus({
      pendingCount: this.queue.read().pending.length,
      errors,
    });

    return { pushed, failed: errors.length, errors };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  private async pushEntry(entry: QueueEntry): Promise<string> {
    switch (entry.action) {
      case 'create': {
        const localItem = this.local.getWorkItem(entry.itemId);
        const remoteItem = this.remote.createWorkItem({
          title: localItem.title,
          type: localItem.type,
          status: localItem.status,
          priority: localItem.priority,
          assignee: localItem.assignee,
          labels: localItem.labels,
          iteration: localItem.iteration,
          description: localItem.description,
          parent: localItem.parent,
          dependsOn: localItem.dependsOn,
        });
        if (remoteItem.id !== entry.itemId) {
          this.renameLocalItem(entry.itemId, remoteItem.id);
          this.queue.renameItem(entry.itemId, remoteItem.id);
          return remoteItem.id;
        }
        return entry.itemId;
      }
      case 'update': {
        const localItem = this.local.getWorkItem(entry.itemId);
        this.remote.updateWorkItem(entry.itemId, {
          title: localItem.title,
          type: localItem.type,
          status: localItem.status,
          priority: localItem.priority,
          assignee: localItem.assignee,
          labels: localItem.labels,
          iteration: localItem.iteration,
          description: localItem.description,
          parent: localItem.parent,
          dependsOn: localItem.dependsOn,
        });
        return entry.itemId;
      }
      case 'delete': {
        this.remote.deleteWorkItem(entry.itemId);
        return entry.itemId;
      }
      case 'comment': {
        if (entry.commentData) {
          this.remote.addComment(entry.itemId, {
            author: entry.commentData.author,
            body: entry.commentData.body,
          });
        }
        return entry.itemId;
      }
      default:
        return entry.itemId;
    }
  }

  private renameLocalItem(oldId: string, newId: string): void {
    const item = this.local.getWorkItem(oldId);
    const root = this.local.getRoot();
    const renamedItem = { ...item, id: newId };
    writeWorkItem(root, renamedItem);
    removeWorkItemFile(root, oldId);
    const allItems = this.local.listWorkItems();
    for (const other of allItems) {
      let changed = false;
      if (other.parent === oldId) {
        other.parent = newId;
        changed = true;
      }
      if (other.dependsOn.includes(oldId)) {
        other.dependsOn = other.dependsOn.map((d) => (d === oldId ? newId : d));
        changed = true;
      }
      if (changed) {
        writeWorkItem(root, other);
      }
    }
  }

  async sync(): Promise<SyncResult> {
    this.updateStatus({ state: 'syncing' });

    const push = await this.pushPending();
    const pullCount = await this.pull();

    this.updateStatus({
      state: push.errors.length > 0 ? 'error' : 'idle',
      pendingCount: this.queue.read().pending.length,
      lastSyncTime: new Date(),
    });

    return { push, pullCount };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  private async pull(): Promise<number> {
    this.local.syncConfigFromRemote({
      iterations: this.remote.getIterations(),
      currentIteration: this.remote.getCurrentIteration(),
      statuses: this.remote.getStatuses(),
      types: this.remote.getWorkItemTypes(),
    });

    const remoteItems = this.remote.listWorkItems();
    const root = this.local.getRoot();
    const pendingIds = new Set(this.queue.read().pending.map((e) => e.itemId));

    const localItems = this.local.listWorkItems();
    const localIds = new Set(localItems.map((i) => i.id));
    const remoteIds = new Set(remoteItems.map((i) => i.id));

    for (const item of remoteItems) {
      writeWorkItem(root, item);
    }

    for (const localId of localIds) {
      if (!remoteIds.has(localId) && !pendingIds.has(localId)) {
        removeWorkItemFile(root, localId);
      }
    }

    return remoteItems.length;
  }
}
