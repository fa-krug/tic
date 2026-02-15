import { describe, it, expect, vi } from 'vitest';
import type { WorkItem, NewWorkItem, Comment, Template } from '../types.js';
import { BaseBackend } from './types.js';
import type { BackendCapabilities } from './types.js';
import { makeWorkItem } from '../test-helpers.js';

/* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */
class TestBackend extends BaseBackend {
  public items: WorkItem[] = [];

  constructor(ttl = 0) {
    super(ttl);
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

  getStatuses = async () => ['open', 'closed'];
  getIterations = async () => ['sprint-1'];
  getWorkItemTypes = async () => ['task'];
  getAssignees = async () => this.getAssigneesFromCache();
  getLabels = async () => this.getLabelsFromCache();
  getCurrentIteration = async () => 'sprint-1';
  setCurrentIteration = async () => {};
  getWorkItem = async (id: string) => this.items.find((i) => i.id === id)!;
  addComment = async () => ({ author: '', date: '', body: '' }) as Comment;
  getItemUrl = () => '';
  openItem = async () => {};

  async listWorkItems(_iteration?: string): Promise<WorkItem[]> {
    return this.items;
  }

  async createWorkItem(data: NewWorkItem): Promise<WorkItem> {
    const item = makeWorkItem(String(this.items.length + 1), {
      title: data.title,
      parent: data.parent,
      dependsOn: data.dependsOn,
    });
    this.items.push(item);
    return item;
  }

  async updateWorkItem(id: string, data: Partial<WorkItem>): Promise<WorkItem> {
    const idx = this.items.findIndex((i) => i.id === id);
    this.items[idx] = { ...this.items[idx]!, ...data };
    return this.items[idx];
  }

  async deleteWorkItem(id: string): Promise<void> {
    this.items = this.items.filter((i) => i.id !== id);
  }

  async listTemplates(): Promise<Template[]> {
    return [];
  }
  async getTemplate(_slug: string): Promise<Template> {
    throw new Error('not implemented');
  }
  async createTemplate(_template: Template): Promise<Template> {
    throw new Error('not implemented');
  }
  async updateTemplate(
    _oldSlug: string,
    _template: Template,
  ): Promise<Template> {
    throw new Error('not implemented');
  }
  async deleteTemplate(_slug: string): Promise<void> {}
}
/* eslint-enable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */

describe('BaseBackend cache integration', () => {
  it('getChildren uses cached items', async () => {
    const b = new TestBackend();
    b.items = [
      makeWorkItem('1'),
      makeWorkItem('2', { parent: '1' }),
      makeWorkItem('3', { parent: '1' }),
      makeWorkItem('4'),
    ];
    const listSpy = vi.spyOn(b, 'listWorkItems');
    const children1 = await b.getChildren('1');
    const children2 = await b.getChildren('1');
    expect(children1).toHaveLength(2);
    expect(children2).toHaveLength(2);
    // listWorkItems called only once due to cache
    expect(listSpy).toHaveBeenCalledTimes(1);
  });

  it('getDependents uses cached items', async () => {
    const b = new TestBackend();
    b.items = [
      makeWorkItem('1'),
      makeWorkItem('2', { dependsOn: ['1'] }),
      makeWorkItem('3', { dependsOn: ['1'] }),
    ];
    const listSpy = vi.spyOn(b, 'listWorkItems');
    const deps = await b.getDependents('1');
    await b.getDependents('1');
    expect(deps).toHaveLength(2);
    expect(listSpy).toHaveBeenCalledTimes(1);
  });

  it('getAssigneesFromCache uses cached items', async () => {
    const b = new TestBackend();
    b.items = [
      makeWorkItem('1', { assignee: 'alice' }),
      makeWorkItem('2', { assignee: 'bob' }),
      makeWorkItem('3', { assignee: 'alice' }),
    ];
    const assignees = await b.getAssignees();
    expect(assignees).toEqual(['alice', 'bob']);
  });

  it('cache invalidates after mutation', async () => {
    const b = new TestBackend();
    b.items = [makeWorkItem('1'), makeWorkItem('2', { parent: '1' })];
    const children1 = await b.getChildren('1');
    expect(children1).toHaveLength(1);

    // Mutate: remove the child relationship
    b.items[1]!.parent = null;
    await b.cachedUpdateWorkItem('2', { parent: null });

    const children2 = await b.getChildren('1');
    expect(children2).toHaveLength(0);
  });
});
