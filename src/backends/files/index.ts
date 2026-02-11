import path from 'node:path';
import fs from 'node:fs/promises';
import { BaseBackend, UnsupportedOperationError } from '../types.js';
import type { BackendCapabilities, SyncableBackend } from '../types.js';
import type {
  WorkItem,
  NewWorkItem,
  NewComment,
  Comment,
  Template,
} from '../../types.js';
import {
  readWorkItem,
  writeWorkItem,
  deleteWorkItem as removeWorkItemFile,
  listItemFiles,
  parseWorkItemFile,
} from '../local/items.js';
import {
  listTemplates as listTemplateFiles,
  readTemplate,
  writeTemplate,
  deleteTemplate as removeTemplateFile,
  slugifyTemplateName,
} from '../local/templates.js';

/**
 * FilesBackend is a filesystem-based sync destination.
 *
 * It delegates all I/O to the existing local/items.ts and local/templates.ts
 * modules. Unlike LocalBackend, it does NOT:
 * - Cache items (caching is the primary backend's job)
 * - Validate relationships (that's the primary backend's job)
 * - Manage config (config lives in the primary/SQLite)
 * - Manage next_id (IDs come from the primary)
 * - Support soft-delete (that's a primary backend concept)
 *
 * It implements SyncableBackend so it can be used as a sync destination
 * with ID-preserving imports via importWorkItem.
 */
export class FilesBackend extends BaseBackend implements SyncableBackend {
  private root: string;

  constructor(root: string) {
    super(0); // no TTL cache
    this.root = root;
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

  // --- Metadata methods: return empty since metadata is the primary's concern ---

  // eslint-disable-next-line @typescript-eslint/require-await
  async getStatuses(): Promise<string[]> {
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getIterations(): Promise<string[]> {
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getWorkItemTypes(): Promise<string[]> {
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getAssignees(): Promise<string[]> {
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getLabels(): Promise<string[]> {
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getCurrentIteration(): Promise<string> {
    return '';
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async setCurrentIteration(_name: string): Promise<void> {
    // no-op: iterations are managed by the primary backend
  }

  // --- Work item CRUD ---

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async listWorkItems(_iteration?: string): Promise<WorkItem[]> {
    const files = await listItemFiles(this.root);
    const items = await Promise.all(
      files.map(async (f) => {
        const raw = await fs.readFile(f, 'utf-8');
        return parseWorkItemFile(raw);
      }),
    );
    // No iteration filtering — that's the primary's job
    return items;
  }

  async getWorkItem(id: string): Promise<WorkItem> {
    return readWorkItem(this.root, id);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async createWorkItem(_data: NewWorkItem): Promise<WorkItem> {
    throw new UnsupportedOperationError('createWorkItem', 'FilesBackend');
  }

  async updateWorkItem(id: string, data: Partial<WorkItem>): Promise<WorkItem> {
    const existing = await this.getWorkItem(id);
    const updated: WorkItem = {
      ...existing,
      ...data,
      id, // preserve ID
      updated: new Date().toISOString(),
    };
    await writeWorkItem(this.root, updated);
    return updated;
  }

  async deleteWorkItem(id: string): Promise<void> {
    await removeWorkItemFile(this.root, id);
    // No relationship cleanup — that's the primary's job
  }

  /**
   * Write a complete WorkItem preserving its existing ID.
   * Used during sync to replicate items from primary to files.
   */
  async importWorkItem(item: WorkItem): Promise<WorkItem> {
    await writeWorkItem(this.root, item);
    return item;
  }

  // --- Comments ---

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

  // --- Item URL ---

  getItemUrl(id: string): string {
    return path.resolve(this.root, '.tic', 'items', `${id}.md`);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async openItem(_id: string): Promise<void> {
    // no-op: FilesBackend is a sync destination, not interactive
  }

  // --- Templates ---

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
