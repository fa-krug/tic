import type { Backend } from '../backends/types.js';
import { isSyncableBackend } from '../backends/types.js';
import type { SyncQueueAdapter } from './types.js';
import type {
  QueueEntry,
  SyncStatus,
  SyncResult,
  PushResult,
  SyncError,
  SyncLogEntry,
} from './types.js';
import type { NewWorkItem, WorkItem } from '../types.js';

type StatusListener = (status: SyncStatus) => void;

export class SyncManager {
  private primary: Backend;
  private remote: Backend;
  private queue: SyncQueueAdapter;
  private status: SyncStatus;
  private listeners: StatusListener[] = [];
  private syncLog: SyncLogEntry[] = [];

  constructor(primary: Backend, remote: Backend, queue: SyncQueueAdapter) {
    this.primary = primary;
    this.remote = remote;
    this.queue = queue;
    this.status = {
      state: 'idle',
      pendingCount: 0,
      lastSyncTime: null,
      errors: [],
      progress: null,
      syncLog: [],
    };
  }

  getStatus(): SyncStatus {
    return { ...this.status };
  }

  onStatusChange(cb: StatusListener): () => void {
    this.listeners.push(cb);
    return () => {
      const idx = this.listeners.indexOf(cb);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  private updateStatus(partial: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...partial };
    for (const cb of this.listeners) {
      cb(this.getStatus());
    }
  }

  private appendLog(entry: SyncLogEntry): void {
    this.syncLog.push(entry);
    if (this.syncLog.length > 50) {
      this.syncLog = this.syncLog.slice(-50);
    }
  }

  async pushPending(): Promise<PushResult> {
    this.updateStatus({ state: 'syncing' });
    const total = (await this.queue.read()).pending.length;
    let current = 0;
    let pushed = 0;
    const errors: SyncError[] = [];
    const idMappings = new Map<string, string>();
    const failedEntries: QueueEntry[] = [];

    while (true) {
      const entry = await this.queue.claimNext();
      if (!entry) break;

      current++;
      this.updateStatus({
        state: 'syncing',
        progress: { phase: 'push', current, total },
        syncLog: [...this.syncLog],
      });

      try {
        const resolvedId = await this.pushEntry(entry);
        if (resolvedId !== entry.itemId) {
          idMappings.set(entry.itemId, resolvedId);
        }
        pushed++;
        this.appendLog({
          phase: 'push',
          action: entry.action,
          itemId: entry.itemId,
          result: 'success',
          timestamp: new Date().toISOString(),
        });
      } catch (e) {
        const isLocalMissing =
          e instanceof Error &&
          'code' in e &&
          (e as NodeJS.ErrnoException).code === 'ENOENT';
        const isNotFound =
          e instanceof Error &&
          (e.message.includes('not found') ||
            e.message.includes('does not exist'));
        if (isLocalMissing || isNotFound) {
          // Local item was deleted or never synced — already claimed (removed) from queue
          this.appendLog({
            phase: 'push',
            action: entry.action,
            itemId: entry.itemId,
            result: 'success',
            message: 'skipped (local item missing)',
            timestamp: new Date().toISOString(),
          });
        } else {
          errors.push({
            entry,
            message: e instanceof Error ? e.message : String(e),
            timestamp: new Date().toISOString(),
          });
          this.appendLog({
            phase: 'push',
            action: entry.action,
            itemId: entry.itemId,
            result: 'error',
            message: e instanceof Error ? e.message : String(e),
            timestamp: new Date().toISOString(),
          });
          // Collect failed entry for re-queuing after the loop
          failedEntries.push(entry);
        }
      }
    }

    // Re-queue all failed entries after the loop to avoid infinite re-claiming
    for (const failed of failedEntries) {
      await this.queue.append(failed);
    }

    this.updateStatus({
      state: errors.length > 0 ? 'error' : 'idle',
      pendingCount: (await this.queue.read()).pending.length,
      errors,
      progress: null,
      syncLog: [...this.syncLog],
    });

    return { pushed, failed: errors.length, errors, idMappings };
  }

  /** Strip fields the remote backend doesn't support to avoid UnsupportedOperationError. */
  private stripUnsupportedFields(data: NewWorkItem): NewWorkItem {
    const caps = this.remote.getCapabilities();
    const result = { ...data };
    if (!caps.fields.priority) {
      result.priority = 'medium';
    }
    if (!caps.fields.assignee) {
      result.assignee = '';
    }
    if (!caps.fields.labels) {
      result.labels = [];
    }
    if (!caps.fields.parent) {
      result.parent = null;
    }
    if (!caps.fields.dependsOn) {
      result.dependsOn = [];
    }
    return result;
  }

  private async pushEntry(entry: QueueEntry): Promise<string> {
    switch (entry.action) {
      case 'create': {
        const localItem = await this.primary.getWorkItem(entry.itemId);
        const remoteItem = await this.remote.createWorkItem(
          this.stripUnsupportedFields({
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
          }),
        );
        if (remoteItem.id !== entry.itemId) {
          await this.renameLocalItem(entry.itemId, remoteItem.id);
          await this.queue.renameItem(entry.itemId, remoteItem.id);
          return remoteItem.id;
        }
        return entry.itemId;
      }
      case 'update': {
        const localItem = await this.primary.getWorkItem(entry.itemId);
        await this.remote.updateWorkItem(
          entry.itemId,
          this.stripUnsupportedFields({
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
          }),
        );
        return entry.itemId;
      }
      case 'delete': {
        // Items with local- prefix were never synced to remote, nothing to delete.
        // Return successfully so the entry is removed from the queue.
        if (!entry.itemId.startsWith('local-')) {
          try {
            await this.remote.deleteWorkItem(entry.itemId);
          } catch (e) {
            // If the item is already gone from remote, treat as success (idempotent delete).
            if (!this.isNotFoundError(e)) {
              throw e;
            }
          }
        }
        return entry.itemId;
      }
      case 'comment': {
        if (entry.commentData) {
          await this.remote.addComment(entry.itemId, {
            author: entry.commentData.author,
            body: entry.commentData.body,
          });
        }
        return entry.itemId;
      }
      case 'template-create': {
        const template = await this.primary.getTemplate(entry.templateSlug!);
        await this.remote.createTemplate(template);
        return entry.itemId;
      }
      case 'template-update': {
        const template = await this.primary.getTemplate(entry.templateSlug!);
        await this.remote.updateTemplate(entry.templateSlug!, template);
        return entry.itemId;
      }
      case 'template-delete': {
        await this.remote.deleteTemplate(entry.templateSlug!);
        return entry.itemId;
      }
      default:
        return entry.itemId;
    }
  }

  /** Check if an error indicates the remote item was not found (already deleted). */
  private isNotFoundError(e: unknown): boolean {
    if (!(e instanceof Error)) return false;
    const msg = e.message.toLowerCase();
    return (
      msg.includes('could not resolve to') ||
      msg.includes('not found') ||
      msg.includes('does not exist') ||
      msg.includes('404')
    );
  }

  private async renameLocalItem(oldId: string, newId: string): Promise<void> {
    const item = await this.primary.getWorkItem(oldId);
    const renamedItem = { ...item, id: newId };

    if (isSyncableBackend(this.primary)) {
      await this.primary.importWorkItem(renamedItem);
    } else {
      await this.primary.createWorkItem(renamedItem as unknown as NewWorkItem);
    }
    await this.primary.deleteWorkItem(oldId);

    // Fix references from other items
    const allItems = await this.primary.listWorkItems();
    for (const other of allItems) {
      const changes: Partial<WorkItem> = {};
      let changed = false;
      if (other.parent === oldId) {
        changes.parent = newId;
        changed = true;
      }
      if (other.dependsOn.includes(oldId)) {
        changes.dependsOn = other.dependsOn.map((d) =>
          d === oldId ? newId : d,
        );
        changed = true;
      }
      if (changed) {
        await this.primary.updateWorkItem(other.id, changes);
      }
    }
  }

  async sync(): Promise<SyncResult> {
    this.updateStatus({ state: 'syncing' });

    const push = await this.pushPending();
    const pullCount = await this.pull();

    this.updateStatus({
      state: push.errors.length > 0 ? 'error' : 'idle',
      pendingCount: (await this.queue.read()).pending.length,
      lastSyncTime: new Date(),
      progress: null,
      syncLog: [...this.syncLog],
    });

    return { push, pullCount };
  }

  private async pull(): Promise<number> {
    // Sync config from remote via configStore
    const [
      remoteIterations,
      remoteCurrentIteration,
      remoteStatuses,
      remoteTypes,
    ] = await Promise.all([
      this.remote.getIterations(),
      this.remote.getCurrentIteration(),
      this.remote.getStatuses(),
      this.remote.getWorkItemTypes(),
    ]);

    const { configStore } = await import('../stores/configStore.js');
    await configStore.getState().update({
      iterations: remoteIterations,
      current_iteration: remoteCurrentIteration,
      statuses: remoteStatuses,
      types: remoteTypes,
    });

    const remoteItems = await this.remote.listWorkItems();
    const pendingIds = new Set(
      (await this.queue.read()).pending.map((e) => e.itemId),
    );

    const localItems = await this.primary.listWorkItems();
    const localIds = new Set(localItems.map((i) => i.id));
    const remoteIds = new Set(remoteItems.map((i) => i.id));

    // Upsert remote items locally
    if (isSyncableBackend(this.primary)) {
      for (const item of remoteItems) {
        await this.primary.importWorkItem(item);
      }
    } else {
      for (const item of remoteItems) {
        if (localIds.has(item.id)) {
          await this.primary.updateWorkItem(item.id, item);
        } else {
          await this.primary.createWorkItem(item as unknown as NewWorkItem);
        }
      }
    }

    // Delete local items not on remote (unless pending)
    for (const localId of localIds) {
      if (!remoteIds.has(localId) && !pendingIds.has(localId)) {
        await this.primary.deleteWorkItem(localId);
      }
    }

    // Pull templates if supported by remote
    const remoteCaps = this.remote.getCapabilities();
    if (remoteCaps.templates) {
      const remoteTemplates = await this.remote.listTemplates();
      const localTemplates = await this.primary.listTemplates();
      const localSlugs = new Set(localTemplates.map((t) => t.slug));
      const remoteSlugs = new Set(remoteTemplates.map((t) => t.slug));

      // Write/update remote templates locally
      for (const rt of remoteTemplates) {
        if (localSlugs.has(rt.slug)) {
          await this.primary.updateTemplate(rt.slug, rt);
        } else {
          await this.primary.createTemplate(rt);
        }
      }

      // Delete local templates not on remote (unless pending in queue)
      const pendingTemplateSlugs = new Set(
        (await this.queue.read()).pending
          .filter((e) => e.action.startsWith('template-'))
          .map((e) => e.templateSlug)
          .filter(Boolean),
      );
      for (const slug of localSlugs) {
        if (!remoteSlugs.has(slug) && !pendingTemplateSlugs.has(slug)) {
          await this.primary.deleteTemplate(slug);
        }
      }
    }

    this.appendLog({
      phase: 'pull',
      action: 'update',
      itemId: '',
      result: 'success',
      message: `${remoteItems.length} item${remoteItems.length === 1 ? '' : 's'}`,
      timestamp: new Date().toISOString(),
    });

    return remoteItems.length;
  }
}
