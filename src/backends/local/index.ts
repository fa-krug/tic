import { BaseBackend } from '../types.js';
import type { BackendCapabilities } from '../types.js';
import type {
  WorkItem,
  NewWorkItem,
  NewComment,
  Comment,
  Template,
} from '../../types.js';
import { configStore } from '../../stores/configStore.js';
import {
  readWorkItem,
  writeWorkItem,
  deleteWorkItem as removeWorkItemFile,
  listItemFiles,
  parseWorkItemFile,
} from './items.js';
import {
  listTemplates as listTemplateFiles,
  readTemplate,
  writeTemplate,
  deleteTemplate as removeTemplateFile,
  slugifyTemplateName,
} from './templates.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface LocalBackendOptions {
  tempIds?: boolean;
}

export class LocalBackend extends BaseBackend {
  private root: string;
  private tempIds: boolean;

  private constructor(root: string, options?: LocalBackendOptions) {
    super(0);
    this.root = root;
    this.tempIds = options?.tempIds ?? false;
  }

  static async create(
    root: string,
    options?: LocalBackendOptions,
  ): Promise<LocalBackend> {
    if (!configStore.getState().loaded) {
      await configStore.getState().init(root);
    }
    return new LocalBackend(root, options);
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
      templates: true,
      templateFields: {
        type: true,
        status: true,
        priority: true,
        assignee: true,
        labels: true,
        iteration: true,
        parent: true,
        dependsOn: true,
        description: true,
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getStatuses(): Promise<string[]> {
    return configStore.getState().config.statuses;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getIterations(): Promise<string[]> {
    return configStore.getState().config.iterations;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getWorkItemTypes(): Promise<string[]> {
    return configStore.getState().config.types;
  }

  async getAssignees(): Promise<string[]> {
    return this.getAssigneesFromCache();
  }

  async getLabels(): Promise<string[]> {
    return this.getLabelsFromCache();
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getCurrentIteration(): Promise<string> {
    return configStore.getState().config.current_iteration;
  }

  async setCurrentIteration(name: string): Promise<void> {
    const config = configStore.getState().config;
    const iterations = config.iterations.includes(name)
      ? config.iterations
      : [...config.iterations, name];
    await configStore
      .getState()
      .update({ current_iteration: name, iterations });
  }

  async syncConfigFromRemote(remote: {
    iterations: string[];
    currentIteration: string;
    statuses: string[];
    types: string[];
  }): Promise<void> {
    await configStore.getState().update({
      iterations: remote.iterations,
      current_iteration: remote.currentIteration,
      statuses: remote.statuses,
      types: remote.types,
    });
  }

  private async validateRelationships(
    id: string,
    parent: string | null | undefined,
    dependsOn: string[] | undefined,
  ): Promise<void> {
    const all = await this.getCachedItems();
    const itemMap = new Map(all.map((item) => [item.id, item]));
    const allIds = new Set(itemMap.keys());

    if (parent !== null && parent !== undefined) {
      if (parent === id) {
        throw new Error(`Work item #${id} cannot be its own parent`);
      }
      if (!allIds.has(parent)) {
        throw new Error(`Parent #${parent} does not exist`);
      }
      let current: string | null = parent;
      const visited = new Set<string>();
      while (current !== null) {
        if (current === id) {
          throw new Error(`Circular parent chain detected for #${id}`);
        }
        if (visited.has(current)) break;
        visited.add(current);
        const parentItem = itemMap.get(current);
        current = parentItem?.parent ?? null;
      }
    }

    if (dependsOn !== undefined) {
      for (const depId of dependsOn) {
        if (depId === id) {
          throw new Error(`Work item #${id} cannot depend on itself`);
        }
        if (!allIds.has(depId)) {
          throw new Error(`Dependency #${depId} does not exist`);
        }
      }
      const hasCycle = (startId: string, targetId: string): boolean => {
        const visited = new Set<string>();
        const stack = [startId];
        while (stack.length > 0) {
          const current = stack.pop()!;
          if (current === targetId) return true;
          if (visited.has(current)) continue;
          visited.add(current);
          const item = itemMap.get(current);
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
    const { next_id, iterations } = configStore.getState().config;
    const id = this.tempIds ? `local-${next_id}` : String(next_id);
    await this.validateRelationships(id, data.parent, data.dependsOn);
    const item: WorkItem = {
      ...data,
      id,
      created: now,
      updated: now,
      comments: [],
    };
    const newIterations =
      data.iteration && !iterations.includes(data.iteration)
        ? [...iterations, data.iteration]
        : iterations;
    await configStore
      .getState()
      .update({ next_id: next_id + 1, iterations: newIterations });
    await writeWorkItem(this.root, item);
    this.invalidateCache();
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
    this.invalidateCache();
    return updated;
  }

  async deleteWorkItem(id: string): Promise<void> {
    await removeWorkItemFile(this.root, id);
    const all = await this.listWorkItems();
    const toWrite: WorkItem[] = [];
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
        toWrite.push(item);
      }
    }
    await Promise.all(toWrite.map((item) => writeWorkItem(this.root, item)));
    this.invalidateCache();
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

  async listTemplates(): Promise<Template[]> {
    return listTemplateFiles(this.root);
  }

  async getTemplate(slug: string): Promise<Template> {
    return readTemplate(this.root, slug);
  }

  async createTemplate(template: Template): Promise<Template> {
    const slug = slugifyTemplateName(template.name);
    const t = { ...template, slug };
    await writeTemplate(this.root, t);
    return t;
  }

  async updateTemplate(oldSlug: string, template: Template): Promise<Template> {
    const newSlug = slugifyTemplateName(template.name);
    if (oldSlug !== newSlug) {
      await removeTemplateFile(this.root, oldSlug);
    }
    const t = { ...template, slug: newSlug };
    await writeTemplate(this.root, t);
    return t;
  }

  async deleteTemplate(slug: string): Promise<void> {
    await removeTemplateFile(this.root, slug);
  }
}
