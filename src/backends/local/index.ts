import { BaseBackend } from '../types.js';
import type { BackendCapabilities } from '../types.js';
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
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface LocalBackendOptions {
  tempIds?: boolean;
}

export class LocalBackend extends BaseBackend {
  private root: string;
  private config: Config;
  private tempIds: boolean;

  constructor(root: string, options?: LocalBackendOptions) {
    super();
    this.root = root;
    this.config = readConfig(root);
    this.tempIds = options?.tempIds ?? false;
  }

  getRoot(): string {
    return this.root;
  }

  getCapabilities(): BackendCapabilities {
    return {
      relationships: true,
      customTypes: true,
      customStatuses: true,
      iterations: true,
      comments: true,
      fields: {
        priority: true,
        assignee: true,
        labels: true,
        parent: true,
        dependsOn: true,
      },
    };
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

  getAssignees(): string[] {
    const items = this.listWorkItems();
    const assignees = new Set<string>();
    for (const item of items) {
      if (item.assignee) {
        assignees.add(item.assignee);
      }
    }
    return [...assignees].sort();
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

  syncConfigFromRemote(remote: {
    iterations: string[];
    currentIteration: string;
    statuses: string[];
    types: string[];
  }): void {
    this.config.iterations = remote.iterations;
    this.config.current_iteration = remote.currentIteration;
    this.config.statuses = remote.statuses;
    this.config.types = remote.types;
    this.save();
  }

  private validateRelationships(
    id: string,
    parent: string | null | undefined,
    dependsOn: string[] | undefined,
  ): void {
    const all = this.listWorkItems();
    const allIds = new Set(all.map((item) => item.id));

    // Validate parent
    if (parent !== null && parent !== undefined) {
      if (parent === id) {
        throw new Error(`Work item #${id} cannot be its own parent`);
      }
      if (!allIds.has(parent)) {
        throw new Error(`Parent #${parent} does not exist`);
      }
      // Check for circular parent chain: walk up from proposed parent
      let current: string | null = parent;
      const visited = new Set<string>();
      while (current !== null) {
        if (current === id) {
          throw new Error(`Circular parent chain detected for #${id}`);
        }
        if (visited.has(current)) break;
        visited.add(current);
        const parentItem = all.find((item) => item.id === current);
        current = parentItem?.parent ?? null;
      }
    }

    // Validate dependsOn
    if (dependsOn !== undefined) {
      for (const depId of dependsOn) {
        if (depId === id) {
          throw new Error(`Work item #${id} cannot depend on itself`);
        }
        if (!allIds.has(depId)) {
          throw new Error(`Dependency #${depId} does not exist`);
        }
      }
      // Check for circular dependency chain: DFS from each dependency
      const hasCycle = (startId: string, targetId: string): boolean => {
        const visited = new Set<string>();
        const stack = [startId];
        while (stack.length > 0) {
          const current = stack.pop()!;
          if (current === targetId) return true;
          if (visited.has(current)) continue;
          visited.add(current);
          const item = all.find((i) => i.id === current);
          if (item) {
            for (const dep of item.dependsOn) {
              stack.push(dep);
            }
          }
        }
        return false;
      };
      for (const depId of dependsOn) {
        if (hasCycle(depId, id)) {
          throw new Error(`Circular dependency chain detected for #${id}`);
        }
      }
    }
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

  getWorkItem(id: string): WorkItem {
    return readWorkItem(this.root, id);
  }

  createWorkItem(data: NewWorkItem): WorkItem {
    this.validateFields(data);
    const now = new Date().toISOString();
    const id = this.tempIds
      ? `local-${this.config.next_id}`
      : String(this.config.next_id);
    this.validateRelationships(id, data.parent, data.dependsOn);
    const item: WorkItem = {
      ...data,
      id,
      created: now,
      updated: now,
      comments: [],
    };
    this.config.next_id = this.config.next_id + 1;
    if (data.iteration && !this.config.iterations.includes(data.iteration)) {
      this.config.iterations.push(data.iteration);
    }
    this.save();
    writeWorkItem(this.root, item);
    return item;
  }

  updateWorkItem(id: string, data: Partial<WorkItem>): WorkItem {
    this.validateFields(data);
    const item = this.getWorkItem(id);
    this.validateRelationships(id, data.parent, data.dependsOn);
    const updated = {
      ...item,
      ...data,
      id,
      updated: new Date().toISOString(),
    };
    writeWorkItem(this.root, updated);
    return updated;
  }

  deleteWorkItem(id: string): void {
    removeWorkItemFile(this.root, id);
    // Clean up references in other items
    const all = this.listWorkItems();
    for (const item of all) {
      let changed = false;
      if (item.parent === id) {
        item.parent = null;
        changed = true;
      }
      if (item.dependsOn.includes(id)) {
        item.dependsOn = item.dependsOn.filter((d) => d !== id);
        changed = true;
      }
      if (changed) {
        writeWorkItem(this.root, item);
      }
    }
  }

  addComment(workItemId: string, comment: NewComment): Comment {
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

  getChildren(id: string): WorkItem[] {
    const all = this.listWorkItems();
    return all.filter((item) => item.parent === id);
  }

  getDependents(id: string): WorkItem[] {
    const all = this.listWorkItems();
    return all.filter((item) => item.dependsOn.includes(id));
  }

  getItemUrl(id: string): string {
    return path.resolve(this.root, '.tic', 'items', `${id}.md`);
  }

  openItem(id: string): void {
    const filePath = this.getItemUrl(id);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Work item #${id} does not exist`);
    }
    const editor = process.env['VISUAL'] || process.env['EDITOR'] || 'vi';
    execSync(`${editor} ${filePath}`, { stdio: 'inherit' });
  }
}
