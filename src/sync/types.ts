export type QueueAction = 'create' | 'update' | 'delete' | 'comment';

export interface QueueEntry {
  action: QueueAction;
  itemId: string;
  timestamp: string;
  /** For comments: the comment body and author */
  commentData?: { author: string; body: string };
}

export interface SyncQueue {
  pending: QueueEntry[];
}

export interface SyncError {
  entry: QueueEntry;
  message: string;
  timestamp: string;
}

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'error';
  pendingCount: number;
  lastSyncTime: Date | null;
  errors: SyncError[];
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
