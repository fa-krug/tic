import type { Backend } from '../types.js';
import type {
  WorkItem,
  NewWorkItem,
  NewComment,
  Comment,
} from '../../types.js';
import { readConfig, writeConfig, type Config } from './config.js';
import {
  readWorkItem,
  writeWorkItem,
  deleteWorkItem as removeWorkItemFile,
  listItemFiles,
  parseWorkItemFile,
} from './items.js';
import fs from 'node:fs';

export class LocalBackend implements Backend {
  private root: string;
  private config: Config;

  constructor(root: string) {
    this.root = root;
    this.config = readConfig(root);
  }

  private save(): void {
    writeConfig(this.root, this.config);
  }

  getStatuses(): string[] {
    return this.config.statuses;
  }

  getIterations(): string[] {
    return this.config.iterations;
  }

  getWorkItemTypes(): string[] {
    return this.config.types;
  }

  getCurrentIteration(): string {
    return this.config.current_iteration;
  }

  setCurrentIteration(name: string): void {
    this.config.current_iteration = name;
    if (!this.config.iterations.includes(name)) {
      this.config.iterations.push(name);
    }
    this.save();
  }

  listWorkItems(iteration?: string): WorkItem[] {
    const files = listItemFiles(this.root);
    const items = files.map((f) => {
      const raw = fs.readFileSync(f, 'utf-8');
      return parseWorkItemFile(raw);
    });
    if (iteration) return items.filter((i) => i.iteration === iteration);
    return items;
  }

  getWorkItem(id: number): WorkItem {
    return readWorkItem(this.root, id);
  }

  createWorkItem(data: NewWorkItem): WorkItem {
    const now = new Date().toISOString();
    const item: WorkItem = {
      ...data,
      id: this.config.next_id,
      created: now,
      updated: now,
      comments: [],
    };
    this.config.next_id++;
    if (data.iteration && !this.config.iterations.includes(data.iteration)) {
      this.config.iterations.push(data.iteration);
    }
    this.save();
    writeWorkItem(this.root, item);
    return item;
  }

  updateWorkItem(id: number, data: Partial<WorkItem>): WorkItem {
    const item = this.getWorkItem(id);
    const updated = {
      ...item,
      ...data,
      id,
      updated: new Date().toISOString(),
    };
    writeWorkItem(this.root, updated);
    return updated;
  }

  deleteWorkItem(id: number): void {
    removeWorkItemFile(this.root, id);
  }

  addComment(workItemId: number, comment: NewComment): Comment {
    const item = this.getWorkItem(workItemId);
    const newComment: Comment = {
      author: comment.author,
      date: new Date().toISOString(),
      body: comment.body,
    };
    item.comments.push(newComment);
    item.updated = new Date().toISOString();
    writeWorkItem(this.root, item);
    return newComment;
  }
}
