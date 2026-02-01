import fs from 'node:fs';
import path from 'node:path';
import type { QueueAction, QueueEntry, SyncQueue } from './types.js';

export class SyncQueueStore {
  private filePath: string;

  constructor(root: string) {
    this.filePath = path.join(root, '.tic', 'sync-queue.json');
  }

  read(): SyncQueue {
    try {
      if (!fs.existsSync(this.filePath)) return { pending: [] };
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const data = JSON.parse(raw) as SyncQueue;
      if (!Array.isArray(data.pending)) return { pending: [] };
      return data;
    } catch {
      return { pending: [] };
    }
  }

  private write(queue: SyncQueue): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(queue, null, 2));
  }

  append(entry: QueueEntry): void {
    const queue = this.read();
    // Collapse: remove existing entry with same itemId + action
    queue.pending = queue.pending.filter(
      (e) => !(e.itemId === entry.itemId && e.action === entry.action),
    );
    queue.pending.push(entry);
    this.write(queue);
  }

  remove(itemId: string, action: QueueAction): void {
    const queue = this.read();
    queue.pending = queue.pending.filter(
      (e) => !(e.itemId === itemId && e.action === action),
    );
    this.write(queue);
  }

  clear(): void {
    this.write({ pending: [] });
  }

  renameItem(oldId: string, newId: string): void {
    const queue = this.read();
    for (const entry of queue.pending) {
      if (entry.itemId === oldId) {
        entry.itemId = newId;
      }
    }
    this.write(queue);
  }
}
