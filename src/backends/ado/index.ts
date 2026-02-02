import { execFileSync } from 'node:child_process';
import { BaseBackend } from '../types.js';
import type { BackendCapabilities } from '../types.js';
import type {
  WorkItem,
  NewWorkItem,
  NewComment,
  Comment,
} from '../../types.js';
import {
  az,
  azExec,
  azInvoke,
  azRest,
  azExecSync,
  azInvokeSync,
} from './az.js';
import { parseAdoRemote } from './remote.js';
import {
  mapWorkItemToWorkItem,
  mapCommentToComment,
  mapPriorityToAdo,
  formatTags,
  extractParent,
  extractPredecessors,
} from './mappers.js';
import type { AdoWorkItem, AdoComment, AdoWorkItemType } from './mappers.js';

export class AzureDevOpsBackend extends BaseBackend {
  private cwd: string;
  private org: string;
  private project: string;
  private types: AdoWorkItemType[];

  constructor(cwd: string) {
    super();
    this.cwd = cwd;
    azExecSync(['account', 'show'], cwd);
    const remote = parseAdoRemote(cwd);
    this.org = remote.org;
    this.project = remote.project;
    this.types = azInvokeSync<{ value: AdoWorkItemType[] }>(
      {
        area: 'wit',
        resource: 'workitemtypes',
        routeParameters: `project=${this.project}`,
        apiVersion: '7.1',
      },
      cwd,
    ).value;
  }

  getCapabilities(): BackendCapabilities {
    return {
      relationships: true,
      customTypes: false,
      customStatuses: false,
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

  // eslint-disable-next-line @typescript-eslint/require-await
  async getStatuses(): Promise<string[]> {
    const allStates = new Set<string>();
    for (const type of this.types) {
      for (const state of type.states) {
        allStates.add(state.name);
      }
    }
    return [...allStates];
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getWorkItemTypes(): Promise<string[]> {
    return this.types.map((t) => t.name);
  }

  async getAssignees(): Promise<string[]> {
    try {
      const members = await az<{ identity: { displayName: string } }[]>(
        [
          'devops',
          'team',
          'list-members',
          '--team',
          `${this.project} Team`,
          '--org',
          `https://dev.azure.com/${this.org}`,
          '--project',
          this.project,
        ],
        this.cwd,
      );
      return members.map((m) => m.identity.displayName);
    } catch {
      return [];
    }
  }

  async getIterations(): Promise<string[]> {
    const iterations = await az<{ path: string }[]>(
      [
        'boards',
        'iteration',
        'team',
        'list',
        '--team',
        `${this.project} Team`,
        '--org',
        `https://dev.azure.com/${this.org}`,
        '--project',
        this.project,
      ],
      this.cwd,
    );
    return iterations.map((i) => i.path);
  }

  async getCurrentIteration(): Promise<string> {
    const iterations = await az<{ path: string }[]>(
      [
        'boards',
        'iteration',
        'team',
        'list',
        '--team',
        `${this.project} Team`,
        '--timeframe',
        'current',
        '--org',
        `https://dev.azure.com/${this.org}`,
        '--project',
        this.project,
      ],
      this.cwd,
    );
    return iterations[0]?.path ?? '';
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async setCurrentIteration(_name: string): Promise<void> {
    // No-op — current iteration is determined by date range in ADO
  }

  private escapeWiql(value: string): string {
    return value.replace(/'/g, "''");
  }

  private async batchFetchWorkItems(ids: number[]): Promise<WorkItem[]> {
    const CHUNK_SIZE = 200;
    const items: WorkItem[] = [];

    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CHUNK_SIZE);
      const batchResult = await azInvoke<{ value: AdoWorkItem[] }>(
        {
          area: 'wit',
          resource: 'workitemsbatch',
          httpMethod: 'POST',
          body: { ids: chunk, $expand: 4 },
          apiVersion: '7.1',
        },
        this.cwd,
      );
      items.push(...batchResult.value.map(mapWorkItemToWorkItem));
    }

    return items;
  }

  async listWorkItems(iteration?: string): Promise<WorkItem[]> {
    let wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${this.escapeWiql(this.project)}'`;
    if (iteration) {
      wiql += ` AND [System.IterationPath] = '${this.escapeWiql(iteration)}'`;
    }

    const queryResult = await az<{ id: number }[]>(
      [
        'boards',
        'query',
        '--wiql',
        wiql,
        '--org',
        `https://dev.azure.com/${this.org}`,
        '--project',
        this.project,
      ],
      this.cwd,
    );

    const ids = queryResult.map((w) => w.id);
    if (ids.length === 0) return [];

    const items = await this.batchFetchWorkItems(ids);
    items.sort((a, b) => b.updated.localeCompare(a.updated));
    return items;
  }

  async getWorkItem(id: string): Promise<WorkItem> {
    // Fetch work item and comments in parallel
    const [ado, commentResult] = await Promise.all([
      az<AdoWorkItem>(
        [
          'boards',
          'work-item',
          'show',
          '--id',
          id,
          '--expand',
          'relations',
          '--org',
          `https://dev.azure.com/${this.org}`,
        ],
        this.cwd,
      ),
      azRest<{ comments: AdoComment[] }>(
        {
          url: `https://dev.azure.com/${this.org}/${encodeURIComponent(this.project)}/_apis/wit/workItems/${id}/comments?api-version=7.1-preview.4`,
        },
        this.cwd,
      ),
    ]);

    const item = mapWorkItemToWorkItem(ado);
    item.comments = (commentResult.comments ?? []).map(mapCommentToComment);
    return item;
  }

  async createWorkItem(data: NewWorkItem): Promise<WorkItem> {
    this.validateFields(data);

    const args = [
      'boards',
      'work-item',
      'create',
      '--type',
      data.type,
      '--title',
      data.title,
      '--org',
      `https://dev.azure.com/${this.org}`,
      '--project',
      this.project,
    ];

    const fields: string[] = [];
    if (data.status) fields.push(`System.State=${data.status}`);
    if (data.iteration) fields.push(`System.IterationPath=${data.iteration}`);
    if (data.priority)
      fields.push(
        `Microsoft.VSTS.Common.Priority=${mapPriorityToAdo(data.priority)}`,
      );
    if (data.assignee) fields.push(`System.AssignedTo=${data.assignee}`);
    if (data.labels.length > 0)
      fields.push(`System.Tags=${formatTags(data.labels)}`);
    if (data.description) fields.push(`System.Description=${data.description}`);

    for (const field of fields) {
      args.push('--fields', field);
    }

    const created = await az<AdoWorkItem>(args, this.cwd);
    const createdId = String(created.id);

    // Add parent relation if specified
    if (data.parent) {
      await azExec(
        [
          'boards',
          'work-item',
          'relation',
          'add',
          '--id',
          createdId,
          '--relation-type',
          'System.LinkTypes.Hierarchy-Reverse',
          '--target-id',
          data.parent,
          '--org',
          `https://dev.azure.com/${this.org}`,
        ],
        this.cwd,
      );
    }

    // Add dependency relations
    for (const depId of data.dependsOn) {
      await azExec(
        [
          'boards',
          'work-item',
          'relation',
          'add',
          '--id',
          createdId,
          '--relation-type',
          'System.LinkTypes.Dependency-Reverse',
          '--target-id',
          depId,
          '--org',
          `https://dev.azure.com/${this.org}`,
        ],
        this.cwd,
      );
    }

    return this.getWorkItem(createdId);
  }

  async updateWorkItem(id: string, data: Partial<WorkItem>): Promise<WorkItem> {
    this.validateFields(data);

    const args = [
      'boards',
      'work-item',
      'update',
      '--id',
      id,
      '--org',
      `https://dev.azure.com/${this.org}`,
    ];

    const fields: string[] = [];
    if (data.title !== undefined) fields.push(`System.Title=${data.title}`);
    if (data.status !== undefined) fields.push(`System.State=${data.status}`);
    if (data.iteration !== undefined)
      fields.push(`System.IterationPath=${data.iteration}`);
    if (data.priority !== undefined)
      fields.push(
        `Microsoft.VSTS.Common.Priority=${mapPriorityToAdo(data.priority)}`,
      );
    if (data.assignee !== undefined)
      fields.push(`System.AssignedTo=${data.assignee}`);
    if (data.labels !== undefined)
      fields.push(`System.Tags=${formatTags(data.labels)}`);
    if (data.description !== undefined)
      fields.push(`System.Description=${data.description}`);

    for (const field of fields) {
      args.push('--fields', field);
    }

    if (fields.length > 0) {
      await az(args, this.cwd);
    }

    // Handle parent relation changes
    if (data.parent !== undefined) {
      const current = await az<AdoWorkItem>(
        [
          'boards',
          'work-item',
          'show',
          '--id',
          id,
          '--expand',
          'relations',
          '--org',
          `https://dev.azure.com/${this.org}`,
        ],
        this.cwd,
      );
      const currentParent = extractParent(current.relations);

      if (currentParent && currentParent !== data.parent) {
        await azExec(
          [
            'boards',
            'work-item',
            'relation',
            'remove',
            '--id',
            id,
            '--relation-type',
            'System.LinkTypes.Hierarchy-Reverse',
            '--target-id',
            currentParent,
            '--org',
            `https://dev.azure.com/${this.org}`,
            '--yes',
          ],
          this.cwd,
        );
      }
      if (data.parent && data.parent !== currentParent) {
        await azExec(
          [
            'boards',
            'work-item',
            'relation',
            'add',
            '--id',
            id,
            '--relation-type',
            'System.LinkTypes.Hierarchy-Reverse',
            '--target-id',
            data.parent,
            '--org',
            `https://dev.azure.com/${this.org}`,
          ],
          this.cwd,
        );
      }
    }

    // Handle dependency relation changes
    if (data.dependsOn !== undefined) {
      const current = await az<AdoWorkItem>(
        [
          'boards',
          'work-item',
          'show',
          '--id',
          id,
          '--expand',
          'relations',
          '--org',
          `https://dev.azure.com/${this.org}`,
        ],
        this.cwd,
      );
      const currentDeps = new Set(extractPredecessors(current.relations));
      const newDeps = new Set(data.dependsOn);

      // Remove deps that are no longer in the list
      for (const dep of currentDeps) {
        if (!newDeps.has(dep)) {
          await azExec(
            [
              'boards',
              'work-item',
              'relation',
              'remove',
              '--id',
              id,
              '--relation-type',
              'System.LinkTypes.Dependency-Reverse',
              '--target-id',
              dep,
              '--org',
              `https://dev.azure.com/${this.org}`,
              '--yes',
            ],
            this.cwd,
          );
        }
      }

      // Add deps that are new
      for (const dep of newDeps) {
        if (!currentDeps.has(dep)) {
          await azExec(
            [
              'boards',
              'work-item',
              'relation',
              'add',
              '--id',
              id,
              '--relation-type',
              'System.LinkTypes.Dependency-Reverse',
              '--target-id',
              dep,
              '--org',
              `https://dev.azure.com/${this.org}`,
            ],
            this.cwd,
          );
        }
      }
    }

    return this.getWorkItem(id);
  }

  async deleteWorkItem(id: string): Promise<void> {
    await azExec(
      [
        'boards',
        'work-item',
        'delete',
        '--id',
        id,
        '--yes',
        '--org',
        `https://dev.azure.com/${this.org}`,
        '--project',
        this.project,
      ],
      this.cwd,
    );
  }

  async addComment(workItemId: string, comment: NewComment): Promise<Comment> {
    await azRest(
      {
        url: `https://dev.azure.com/${this.org}/${encodeURIComponent(this.project)}/_apis/wit/workItems/${workItemId}/comments?api-version=7.1-preview.4`,
        httpMethod: 'POST',
        body: { text: comment.body },
      },
      this.cwd,
    );

    return {
      author: comment.author,
      date: new Date().toISOString(),
      body: comment.body,
    };
  }

  async getChildren(id: string): Promise<WorkItem[]> {
    const numericId = parseInt(id, 10);
    if (isNaN(numericId)) throw new Error(`Invalid work item ID: "${id}"`);

    const wiql = `SELECT [System.Id] FROM WorkItemLinks WHERE [Source].[System.Id] = ${numericId} AND [System.Links.LinkType] = 'System.LinkTypes.Hierarchy-Forward' MODE (MustContain)`;

    const queryResult = await az<{ id: number }[]>(
      [
        'boards',
        'query',
        '--wiql',
        wiql,
        '--org',
        `https://dev.azure.com/${this.org}`,
        '--project',
        this.project,
      ],
      this.cwd,
    );

    // Filter out the source item (link queries include it)
    const ids = queryResult.map((w) => w.id).filter((wid) => wid !== numericId);
    if (ids.length === 0) return [];

    return this.batchFetchWorkItems(ids);
  }

  async getDependents(id: string): Promise<WorkItem[]> {
    const numericId = parseInt(id, 10);
    if (isNaN(numericId)) throw new Error(`Invalid work item ID: "${id}"`);

    const wiql = `SELECT [System.Id] FROM WorkItemLinks WHERE [Source].[System.Id] = ${numericId} AND [System.Links.LinkType] = 'System.LinkTypes.Dependency-Forward' MODE (MustContain)`;

    const queryResult = await az<{ id: number }[]>(
      [
        'boards',
        'query',
        '--wiql',
        wiql,
        '--org',
        `https://dev.azure.com/${this.org}`,
        '--project',
        this.project,
      ],
      this.cwd,
    );

    // Filter out the source item (link queries include it)
    const ids = queryResult.map((w) => w.id).filter((wid) => wid !== numericId);
    if (ids.length === 0) return [];

    return this.batchFetchWorkItems(ids);
  }

  getItemUrl(id: string): string {
    return `https://dev.azure.com/${this.org}/${encodeURIComponent(this.project)}/_workitems/edit/${id}`;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async openItem(id: string): Promise<void> {
    const url = this.getItemUrl(id);
    execFileSync('open', [url]);
  }
}
