import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  QueueAction,
  QueueEntry,
  SyncQueueData,
  SyncQueueAdapter,
} from './types.js';

export class SyncQueueStore implements SyncQueueAdapter {
  private filePath: string;

  constructor(root: string) {
    this.filePath = path.join(root, '.tic', 'sync-queue.json');
  }

  async read(): Promise<SyncQueueData> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const data = JSON.parse(raw) as SyncQueueData;
      if (!Array.isArray(data.pending)) return { pending: [] };
      return data;
    } catch {
      return { pending: [] };
    }
  }

  private async write(queue: SyncQueueData): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(queue, null, 2));
  }

  async append(entry: QueueEntry): Promise<void> {
    const queue = await this.read();
    // Collapse: remove existing entry with same itemId + action
    queue.pending = queue.pending.filter(
      (e) => !(e.itemId === entry.itemId && e.action === entry.action),
    );
    queue.pending.push(entry);
    await this.write(queue);
  }

  async remove(itemId: string, action: QueueAction): Promise<void> {
    const queue = await this.read();
    queue.pending = queue.pending.filter(
      (e) => !(e.itemId === itemId && e.action === action),
    );
    await this.write(queue);
  }

  async removeByIds(itemIds: string[], action: QueueAction): Promise<void> {
    const queue = await this.read();
    const idSet = new Set(itemIds);
    queue.pending = queue.pending.filter(
      (e) => !(idSet.has(e.itemId) && e.action === action),
    );
    await this.write(queue);
  }

  async clear(): Promise<void> {
    await this.write({ pending: [] });
  }

  async claimNext(): Promise<QueueEntry | null> {
    const data = await this.read();
    if (data.pending.length === 0) return null;
    const entry = data.pending[0]!;
    await this.remove(entry.itemId, entry.action);
    return entry;
  }

  async renameItem(oldId: string, newId: string): Promise<void> {
    const queue = await this.read();
    for (const entry of queue.pending) {
      if (entry.itemId === oldId) {
        entry.itemId = newId;
      }
    }
    await this.write(queue);
  }
}
