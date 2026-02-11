export type QueueAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'comment'
  | 'template-create'
  | 'template-update'
  | 'template-delete';

export interface QueueEntry {
  action: QueueAction;
  itemId: string;
  timestamp: string;
  /** For comments: the comment body and author */
  commentData?: { author: string; body: string };
  /** For templates: the template slug */
  templateSlug?: string;
}

export interface SyncQueueData {
  pending: QueueEntry[];
}

export interface SyncQueueAdapter {
  read(): SyncQueueData | Promise<SyncQueueData>;
  append(entry: QueueEntry): void | Promise<void>;
  remove(itemId: string, action: QueueAction): void | Promise<void>;
  removeByIds(itemIds: string[], action: QueueAction): void | Promise<void>;
  claimNext(): QueueEntry | null | Promise<QueueEntry | null>;
  clear(): void | Promise<void>;
  renameItem(oldId: string, newId: string): void | Promise<void>;
}

export interface SyncError {
  entry: QueueEntry;
  message: string;
  timestamp: string;
}

export interface SyncProgress {
  phase: 'push' | 'pull';
  current: number;
  total: number;
}

export interface SyncLogEntry {
  phase: 'push' | 'pull';
  action: QueueAction;
  itemId: string;
  result: 'success' | 'error';
  message?: string;
  timestamp: string;
}

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'error';
  pendingCount: number;
  lastSyncTime: Date | null;
  errors: SyncError[];
  progress: SyncProgress | null;
  syncLog: SyncLogEntry[];
}

export interface PushResult {
  pushed: number;
  failed: number;
  errors: SyncError[];
  /** Maps local temp IDs to resolved remote IDs (e.g. "local-1" → "42") */
  idMappings: Map<string, string>;
}

export interface SyncResult {
  push: PushResult;
  pullCount: number;
}
