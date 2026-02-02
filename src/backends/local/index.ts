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
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface LocalBackendOptions {
  tempIds?: boolean;
}

export class LocalBackend extends BaseBackend {
  private root: string;
  private config: Config;
  private tempIds: boolean;

  private constructor(
    root: string,
    config: Config,
    options?: LocalBackendOptions,
  ) {
    super();
    this.root = root;
    this.config = config;
    this.tempIds = options?.tempIds ?? false;
  }

  static async create(
    root: string,
    options?: LocalBackendOptions,
  ): Promise<LocalBackend> {
    const config = await readConfig(root);
    return new LocalBackend(root, config, options);
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

  private async save(): Promise<void> {
    await writeConfig(this.root, this.config);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getStatuses(): Promise<string[]> {
    return this.config.statuses;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getIterations(): Promise<string[]> {
    return this.config.iterations;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getWorkItemTypes(): Promise<string[]> {
    return this.config.types;
  }

  async getAssignees(): Promise<string[]> {
    const items = await this.listWorkItems();
    const assignees = new Set<string>();
    for (const item of items) {
      if (item.assignee) {
        assignees.add(item.assignee);
      }
    }
    return [...assignees].sort();
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getCurrentIteration(): Promise<string> {
    return this.config.current_iteration;
  }

  async setCurrentIteration(name: string): Promise<void> {
    this.config.current_iteration = name;
    if (!this.config.iterations.includes(name)) {
      this.config.iterations.push(name);
    }
    await this.save();
  }

  async syncConfigFromRemote(remote: {
    iterations: string[];
    currentIteration: string;
    statuses: string[];
    types: string[];
  }): Promise<void> {
    this.config.iterations = remote.iterations;
    this.config.current_iteration = remote.currentIteration;
    this.config.statuses = remote.statuses;
    this.config.types = remote.types;
    await this.save();
  }

  private async validateRelationships(
    id: string,
    parent: string | null | undefined,
    dependsOn: string[] | undefined,
  ): Promise<void> {
    const all = await this.listWorkItems();
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

  async listWorkItems(iteration?: string): Promise<WorkItem[]> {
    const files = await listItemFiles(this.root);
    const items = await Promise.all(
      files.map(async (f) => {
        const raw = await fs.readFile(f, 'utf-8');
        return parseWorkItemFile(raw);
      }),
    );
    if (iteration) return items.filter((i) => i.iteration === iteration);
    return items;
  }

  async getWorkItem(id: string): Promise<WorkItem> {
    return await readWorkItem(this.root, id);
  }

  async createWorkItem(data: NewWorkItem): Promise<WorkItem> {
    this.validateFields(data);
    const now = new Date().toISOString();
    const id = this.tempIds
      ? `local-${this.config.next_id}`
      : String(this.config.next_id);
    await this.validateRelationships(id, data.parent, data.dependsOn);
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
    await this.save();
    await writeWorkItem(this.root, item);
    return item;
  }

  async updateWorkItem(id: string, data: Partial<WorkItem>): Promise<WorkItem> {
    this.validateFields(data);
    const item = await this.getWorkItem(id);
    await this.validateRelationships(id, data.parent, data.dependsOn);
    const updated = {
      ...item,
      ...data,
      id,
      updated: new Date().toISOString(),
    };
    await writeWorkItem(this.root, updated);
    return updated;
  }

  async deleteWorkItem(id: string): Promise<void> {
    await removeWorkItemFile(this.root, id);
    // Clean up references in other items
    const all = await this.listWorkItems();
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
        await writeWorkItem(this.root, item);
      }
    }
  }

  async addComment(workItemId: string, comment: NewComment): Promise<Comment> {
    const item = await this.getWorkItem(workItemId);
    const newComment: Comment = {
      author: comment.author,
      date: new Date().toISOString(),
      body: comment.body,
    };
    item.comments.push(newComment);
    item.updated = new Date().toISOString();
    await writeWorkItem(this.root, item);
    return newComment;
  }

  override async getChildren(id: string): Promise<WorkItem[]> {
    const all = await this.listWorkItems();
    return all.filter((item) => item.parent === id);
  }

  override async getDependents(id: string): Promise<WorkItem[]> {
    const all = await this.listWorkItems();
    return all.filter((item) => item.dependsOn.includes(id));
  }

  getItemUrl(id: string): string {
    return path.resolve(this.root, '.tic', 'items', `${id}.md`);
  }

  async openItem(id: string): Promise<void> {
    const filePath = this.getItemUrl(id);
    await fs.access(filePath);
    const editor = process.env['VISUAL'] || process.env['EDITOR'] || 'vi';
    return new Promise<void>((resolve, reject) => {
      const child = spawn(editor, [filePath], { stdio: 'inherit' });
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Editor exited with code ${code}`));
      });
      child.on('error', reject);
    });
  }
}
