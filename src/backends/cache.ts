import type { WorkItem } from '../types.js';

export class BackendCache {
  private items: WorkItem[] | null = null;
  private itemsByIteration = new Map<string, WorkItem[]>();
  private timestamp = 0;
  private readonly ttl: number;

  constructor(ttl: number) {
    this.ttl = ttl;
  }

  get(iteration?: string): WorkItem[] | null {
    if (this.ttl > 0 && Date.now() - this.timestamp > this.ttl) {
      this.invalidate();
      return null;
    }
    if (iteration !== undefined) {
      return this.itemsByIteration.get(iteration) ?? null;
    }
    return this.items;
  }

  set(items: WorkItem[], iteration?: string): void {
    if (iteration !== undefined) {
      this.itemsByIteration.set(iteration, items);
    } else {
      this.items = items;
    }
    if (this.timestamp === 0) {
      this.timestamp = Date.now();
    }
  }

  invalidate(): void {
    this.items = null;
    this.itemsByIteration.clear();
    this.timestamp = 0;
  }
}
