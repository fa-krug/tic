import type { Backend } from '../backends/types.js';
import { isSyncableBackend, isPrBackend } from '../backends/types.js';
import type { SyncQueueAdapter } from './types.js';
import type {
  QueueEntry,
  SyncStatus,
  SyncResult,
  PushResult,
  SyncError,
  SyncLogEntry,
} from './types.js';
import type { Storage } from '../storage/index.js';

/**
 * Data shape sent to remote backends for create/update.
 * Uses string-based parent/dependsOn (display IDs) since remote backends
 * don't know about local rowIds.
 */
interface RemoteWorkItemData {
  title: string;
  type: string;
  status: string;
  priority: string;
  assignee: string;
  labels: string[];
  iteration: string;
  description: string;
  parent: string | null;
  dependsOn: string[];
}

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

  private get storage(): Storage {
    return this.primary as Storage;
  }

  async pushPending(): Promise<PushResult> {
    this.updateStatus({ state: 'syncing' });
    const total = (await this.queue.read()).pending.length;
    let current = 0;
    let pushed = 0;
    const errors: SyncError[] = [];
    const idMappings = new Map<number, string>();
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
        const mapping = await this.pushEntry(entry);
        if (mapping) {
          idMappings.set(mapping.rowId, mapping.displayId);
        }
        pushed++;
        this.appendLog({
          phase: 'push',
          action: entry.action,
          itemRowId: entry.itemRowId,
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
            itemRowId: entry.itemRowId,
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
            itemRowId: entry.itemRowId,
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
  private stripUnsupportedFields(data: RemoteWorkItemData): {
    data: RemoteWorkItemData;
    strippedFields: string[];
  } {
    const caps = this.remote.getCapabilities();
    const result = { ...data };
    const strippedFields: string[] = [];
    if (!caps.fields.priority && data.priority !== 'medium') {
      result.priority = 'medium';
      strippedFields.push('priority');
    }
    if (!caps.fields.assignee && data.assignee) {
      result.assignee = '';
      strippedFields.push('assignee');
    }
    if (!caps.fields.labels && data.labels.length > 0) {
      result.labels = [];
      strippedFields.push('labels');
    }
    if (!caps.fields.parent && data.parent) {
      result.parent = null;
      strippedFields.push('parent');
    }
    if (!caps.fields.dependsOn && data.dependsOn.length > 0) {
      result.dependsOn = [];
      strippedFields.push('dependsOn');
    }
    return { data: result, strippedFields };
  }

  /**
   * Resolve a local item's parent/dependsOn rowIds to display ID strings
   * for sending to a remote backend.
   */
  private async resolveRelationshipsToDisplayIds(localItem: {
    parent: number | null;
    dependsOn: number[];
  }): Promise<{ parent: string | null; dependsOn: string[] }> {
    let parentDisplayId: string | null = null;
    if (localItem.parent !== null) {
      const parentItem = await this.storage.getWorkItemByRowId(
        localItem.parent,
      );
      parentDisplayId = parentItem.id;
    }

    const dependsOnDisplayIds: string[] = [];
    for (const depRowId of localItem.dependsOn) {
      const dep = await this.storage.getWorkItemByRowId(depRowId);
      if (dep.id) {
        dependsOnDisplayIds.push(dep.id);
      }
    }

    return { parent: parentDisplayId, dependsOn: dependsOnDisplayIds };
  }

  private async pushEntry(
    entry: QueueEntry,
  ): Promise<{ rowId: number; displayId: string } | null> {
    switch (entry.action) {
      case 'create': {
        const localItem = await this.storage.getWorkItemByRowId(
          entry.itemRowId,
        );
        const { parent, dependsOn } =
          await this.resolveRelationshipsToDisplayIds(localItem);

        const remoteData: RemoteWorkItemData = {
          title: localItem.title,
          type: localItem.type,
          status: localItem.status,
          priority: localItem.priority,
          assignee: localItem.assignee,
          labels: localItem.labels,
          iteration: localItem.iteration,
          description: localItem.description,
          parent,
          dependsOn,
        };

        const { data: strippedCreate, strippedFields: strippedCreateFields } =
          this.stripUnsupportedFields(remoteData);
        if (strippedCreateFields.length > 0) {
          const { uiStore } = await import('../stores/uiStore.js');
          uiStore
            .getState()
            .setToast(
              `Sync: ${strippedCreateFields.join(', ')} stripped (unsupported by remote)`,
            );
          this.appendLog({
            phase: 'push',
            action: 'create',
            itemRowId: entry.itemRowId,
            result: 'success',
            message: `stripped fields: ${strippedCreateFields.join(', ')}`,
            timestamp: new Date().toISOString(),
          });
        }
        // Cast to NewWorkItem — remote backends expect string parent/dependsOn
        const remoteItem = await this.remote.createWorkItem(
          strippedCreate as unknown as import('../types.js').NewWorkItem,
        );

        // Set display ID on local item — no rename cascade needed!
        this.storage.setDisplayId(entry.itemRowId, remoteItem.id!);
        return { rowId: entry.itemRowId, displayId: remoteItem.id! };
      }
      case 'update': {
        const localItem = await this.storage.getWorkItemByRowId(
          entry.itemRowId,
        );
        const displayId = localItem.id!;
        const { parent, dependsOn } =
          await this.resolveRelationshipsToDisplayIds(localItem);

        const remoteData: RemoteWorkItemData = {
          title: localItem.title,
          type: localItem.type,
          status: localItem.status,
          priority: localItem.priority,
          assignee: localItem.assignee,
          labels: localItem.labels,
          iteration: localItem.iteration,
          description: localItem.description,
          parent,
          dependsOn,
        };

        const { data: strippedUpdate, strippedFields: strippedUpdateFields } =
          this.stripUnsupportedFields(remoteData);
        if (strippedUpdateFields.length > 0) {
          const { uiStore } = await import('../stores/uiStore.js');
          uiStore
            .getState()
            .setToast(
              `Sync: ${strippedUpdateFields.join(', ')} stripped (unsupported by remote)`,
            );
          this.appendLog({
            phase: 'push',
            action: 'update',
            itemRowId: entry.itemRowId,
            result: 'success',
            message: `stripped fields: ${strippedUpdateFields.join(', ')}`,
            timestamp: new Date().toISOString(),
          });
        }
        await this.remote.updateWorkItem(
          displayId,
          strippedUpdate as unknown as Partial<import('../types.js').WorkItem>,
        );
        return null;
      }
      case 'delete': {
        // Look up display ID (item may be soft-deleted)
        const displayId = this.storage.getDisplayIdByRowId(entry.itemRowId);

        // Items with no display ID were never synced to remote, nothing to delete
        if (displayId) {
          try {
            await this.remote.deleteWorkItem(displayId);
          } catch (e) {
            // If the item is already gone from remote, treat as success (idempotent delete).
            if (!this.isNotFoundError(e)) {
              throw e;
            }
          }
        }
        return null;
      }
      case 'comment': {
        if (entry.commentData) {
          const localItem = await this.storage.getWorkItemByRowId(
            entry.itemRowId,
          );
          const displayId = localItem.id!;
          await this.remote.addComment(displayId, {
            author: entry.commentData.author,
            body: entry.commentData.body,
          });
        }
        return null;
      }
      case 'template-create': {
        const template = await this.primary.getTemplate(entry.templateSlug!);
        await this.remote.createTemplate(template);
        return null;
      }
      case 'template-update': {
        const template = await this.primary.getTemplate(entry.templateSlug!);
        await this.remote.updateTemplate(entry.templateSlug!, template);
        return null;
      }
      case 'template-delete': {
        await this.remote.deleteTemplate(entry.templateSlug!);
        return null;
      }
      default:
        return null;
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
    // pendingRowIds: rowIds that are pending in the queue
    const pendingRowIds = new Set(
      (await this.queue.read()).pending.map((e) => e.itemRowId),
    );

    const localItems = await this.primary.listWorkItems();
    // Compare by display IDs (strings) for local vs remote reconciliation
    const localDisplayIds = new Set(
      localItems.map((i) => i.id).filter(Boolean) as string[],
    );
    const remoteDisplayIds = new Set(
      remoteItems.map((i) => i.id).filter(Boolean) as string[],
    );

    // Upsert remote items locally
    if (isSyncableBackend(this.primary)) {
      for (const item of remoteItems) {
        await this.primary.importWorkItem(item);
      }
    } else {
      for (const item of remoteItems) {
        if (localDisplayIds.has(item.id!)) {
          await this.primary.updateWorkItem(item.id!, item);
        } else {
          await this.primary.createWorkItem(
            item as unknown as import('../types.js').NewWorkItem,
          );
        }
      }
    }

    // Delete local items not on remote (unless pending in queue)
    // Only delete items that have a display ID (synced items)
    for (const localItem of localItems) {
      if (
        localItem.id &&
        !remoteDisplayIds.has(localItem.id) &&
        !pendingRowIds.has(localItem.rowId)
      ) {
        await this.primary.deleteWorkItem(localItem.id);
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
        (await this.queue.read())
          .pending.filter((e) => e.action.startsWith('template-'))
          .map((e) => e.templateSlug)
          .filter(Boolean),
      );
      for (const slug of localSlugs) {
        if (!remoteSlugs.has(slug) && !pendingTemplateSlugs.has(slug)) {
          await this.primary.deleteTemplate(slug);
        }
      }
    }

    // Pull PRs if supported by remote
    if (isPrBackend(this.remote)) {
      const remotePrs = await this.remote.listPullRequests();
      const primaryStorage = this.storage;
      if ('importPullRequest' in primaryStorage) {
        for (const pr of remotePrs) {
          await primaryStorage.importPullRequest(pr);
        }
      }
    }

    this.appendLog({
      phase: 'pull',
      action: 'update',
      itemRowId: 0,
      result: 'success',
      message: `${remoteItems.length} item${remoteItems.length === 1 ? '' : 's'}`,
      timestamp: new Date().toISOString(),
    });

    return remoteItems.length;
  }
}
