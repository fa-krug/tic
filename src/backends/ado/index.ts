import { execFileSync } from 'node:child_process';
import { BaseBackend, UnsupportedOperationError } from '../types.js';
import type { BackendCapabilities } from '../types.js';
import type {
  WorkItem,
  NewWorkItem,
  NewComment,
  Comment,
  Template,
} from '../../types.js';
import { getAdoToken, getAdoPat, authenticateAdo } from '../../auth/ado.js';
import { AuthError } from '../shared/api-client.js';
import { AdoApiClient } from './api.js';
import type { AdoAuth } from './api.js';
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

export interface AzureDevOpsBackendOptions {
  skipAuth?: boolean;
}

interface JsonPatchOp {
  op: 'add' | 'remove' | 'replace' | 'test';
  path: string;
  value?: unknown;
}

export class AzureDevOpsBackend extends BaseBackend {
  private api: AdoApiClient;
  private org: string;
  private project: string;
  private types: AdoWorkItemType[];

  private constructor(
    api: AdoApiClient,
    org: string,
    project: string,
    types: AdoWorkItemType[],
  ) {
    super(60_000);
    this.api = api;
    this.org = org;
    this.project = project;
    this.types = types;
  }

  static async create(
    cwd: string,
    options?: AzureDevOpsBackendOptions,
  ): Promise<AzureDevOpsBackend> {
    const remote = parseAdoRemote(cwd);

    let auth: AdoAuth | null = null;
    const token = getAdoToken();
    const pat = getAdoPat();

    if (token) {
      auth = { type: 'bearer', token };
    } else if (pat) {
      auth = { type: 'basic', pat };
    }

    if (!auth) {
      if (options?.skipAuth) {
        throw new AuthError(
          'Azure DevOps authentication required. Run "tic auth login ado" to authenticate.',
        );
      }
      const accessToken = await authenticateAdo({
        onCode: (code, url) => {
          console.log(`\nAzure DevOps authentication required.`);
          console.log(`Visit ${url} and enter code: ${code}\n`);
        },
      });
      auth = { type: 'bearer', token: accessToken };
    }

    const api = new AdoApiClient(auth, remote.org);

    // Fetch work item types to verify auth and cache type metadata
    const typesResult = await api.rest<{ value: AdoWorkItemType[] }>(
      'GET',
      `/${remote.project}/_apis/wit/workitemtypes`,
    );

    return new AzureDevOpsBackend(
      api,
      remote.org,
      remote.project,
      typesResult.value,
    );
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
      templates: false,
      templateFields: {
        type: false,
        status: false,
        priority: false,
        assignee: false,
        labels: false,
        iteration: false,
        parent: false,
        dependsOn: false,
        description: false,
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
      const result = await this.api.rest<{
        value: { identity: { displayName: string } }[];
      }>(
        'GET',
        `/_apis/projects/${encodeURIComponent(this.project)}/teams/${encodeURIComponent(this.project + ' Team')}/members`,
      );
      return result.value
        .map((m) => m.identity?.displayName)
        .filter((name): name is string => !!name);
    } catch {
      return [];
    }
  }

  async getLabels(): Promise<string[]> {
    return this.getLabelsFromCache();
  }

  async getIterations(): Promise<string[]> {
    const result = await this.api.rest<{
      value: { path: string }[];
    }>(
      'GET',
      `/${encodeURIComponent(this.project)}/${encodeURIComponent(this.project + ' Team')}/_apis/work/teamsettings/iterations`,
    );
    return result.value.map((i) => i.path);
  }

  async getCurrentIteration(): Promise<string> {
    const result = await this.api.rest<{
      value: { path: string }[];
    }>(
      'GET',
      `/${encodeURIComponent(this.project)}/${encodeURIComponent(this.project + ' Team')}/_apis/work/teamsettings/iterations?$timeframe=current`,
    );
    return result.value[0]?.path ?? '';
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async setCurrentIteration(_name: string): Promise<void> {
    // No-op — current iteration is determined by date range in ADO
  }

  private escapeWiql(value: string): string {
    return value.replace(/'/g, "''");
  }

  private async batchFetchWorkItems(ids: number[]): Promise<WorkItem[]> {
    const result = await this.api.batchGetWorkItems<{
      value: AdoWorkItem[];
    }>(ids);
    return result.value.map(mapWorkItemToWorkItem);
  }

  async listWorkItems(iteration?: string): Promise<WorkItem[]> {
    let wiql = `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = '${this.escapeWiql(this.project)}'`;
    if (iteration) {
      wiql += ` AND [System.IterationPath] = '${this.escapeWiql(iteration)}'`;
    }

    const queryResult = await this.api.wiql<{
      workItems: { id: number }[];
    }>(this.project, wiql);

    const ids = queryResult.workItems.map((w) => w.id);
    if (ids.length === 0) return [];

    const items = await this.batchFetchWorkItems(ids);
    items.sort((a, b) => b.updated.localeCompare(a.updated));
    return items;
  }

  async getWorkItem(id: string): Promise<WorkItem> {
    const [ado, commentResult] = await Promise.all([
      this.api.rest<AdoWorkItem>(
        'GET',
        `/${encodeURIComponent(this.project)}/_apis/wit/workitems/${id}?$expand=relations`,
      ),
      this.api
        .rest<{
          comments: AdoComment[];
        }>(
          'GET',
          `/${encodeURIComponent(this.project)}/_apis/wit/workItems/${id}/comments?api-version=7.1-preview.4`,
        )
        .catch(() => ({ comments: [] as AdoComment[] })),
    ]);

    const item = mapWorkItemToWorkItem(ado);
    item.comments = (commentResult.comments ?? []).map(mapCommentToComment);
    return item;
  }

  async createWorkItem(data: NewWorkItem): Promise<WorkItem> {
    this.validateFields(data);

    const patch: JsonPatchOp[] = [
      { op: 'add', path: '/fields/System.Title', value: data.title },
    ];

    if (data.status)
      patch.push({
        op: 'add',
        path: '/fields/System.State',
        value: data.status,
      });
    if (data.iteration)
      patch.push({
        op: 'add',
        path: '/fields/System.IterationPath',
        value: data.iteration,
      });
    if (data.priority)
      patch.push({
        op: 'add',
        path: '/fields/Microsoft.VSTS.Common.Priority',
        value: mapPriorityToAdo(data.priority),
      });
    if (data.assignee)
      patch.push({
        op: 'add',
        path: '/fields/System.AssignedTo',
        value: data.assignee,
      });
    if (data.labels.length > 0)
      patch.push({
        op: 'add',
        path: '/fields/System.Tags',
        value: formatTags(data.labels),
      });
    if (data.description)
      patch.push({
        op: 'add',
        path: '/fields/System.Description',
        value: data.description,
      });

    // Add parent relation in same request
    if (data.parent) {
      patch.push({
        op: 'add',
        path: '/relations/-',
        value: {
          rel: 'System.LinkTypes.Hierarchy-Reverse',
          url: `https://dev.azure.com/${this.org}/_apis/wit/workitems/${data.parent}`,
        },
      });
    }

    // Add dependency relations in same request
    for (const depId of data.dependsOn) {
      patch.push({
        op: 'add',
        path: '/relations/-',
        value: {
          rel: 'System.LinkTypes.Dependency-Reverse',
          url: `https://dev.azure.com/${this.org}/_apis/wit/workitems/${depId}`,
        },
      });
    }

    const created = await this.api.rest<AdoWorkItem>(
      'POST',
      `/${encodeURIComponent(this.project)}/_apis/wit/workitems/$${encodeURIComponent(data.type)}`,
      patch,
      'application/json-patch+json',
    );

    return this.getWorkItem(String(created.id));
  }

  async updateWorkItem(id: string, data: Partial<WorkItem>): Promise<WorkItem> {
    this.validateFields(data);

    const patch: JsonPatchOp[] = [];

    if (data.title !== undefined)
      patch.push({
        op: 'replace',
        path: '/fields/System.Title',
        value: data.title,
      });
    if (data.status !== undefined)
      patch.push({
        op: 'replace',
        path: '/fields/System.State',
        value: data.status,
      });
    if (data.iteration !== undefined)
      patch.push({
        op: 'replace',
        path: '/fields/System.IterationPath',
        value: data.iteration,
      });
    if (data.priority !== undefined)
      patch.push({
        op: 'replace',
        path: '/fields/Microsoft.VSTS.Common.Priority',
        value: mapPriorityToAdo(data.priority),
      });
    if (data.assignee !== undefined)
      patch.push({
        op: 'replace',
        path: '/fields/System.AssignedTo',
        value: data.assignee,
      });
    if (data.labels !== undefined)
      patch.push({
        op: 'replace',
        path: '/fields/System.Tags',
        value: formatTags(data.labels),
      });
    if (data.description !== undefined)
      patch.push({
        op: 'replace',
        path: '/fields/System.Description',
        value: data.description,
      });

    // Handle relation changes — need to fetch current relations first
    if (data.parent !== undefined || data.dependsOn !== undefined) {
      const current = await this.api.rest<AdoWorkItem>(
        'GET',
        `/${encodeURIComponent(this.project)}/_apis/wit/workitems/${id}?$expand=relations`,
      );

      if (data.parent !== undefined) {
        const currentParent = extractParent(current.relations);

        if (currentParent && currentParent !== data.parent) {
          // Find the index of the parent relation to remove it
          const parentIdx = current.relations?.findIndex(
            (r) => r.rel === 'System.LinkTypes.Hierarchy-Reverse',
          );
          if (parentIdx !== undefined && parentIdx >= 0) {
            patch.push({
              op: 'remove',
              path: `/relations/${parentIdx}`,
            });
          }
        }
        if (data.parent && data.parent !== currentParent) {
          patch.push({
            op: 'add',
            path: '/relations/-',
            value: {
              rel: 'System.LinkTypes.Hierarchy-Reverse',
              url: `https://dev.azure.com/${this.org}/_apis/wit/workitems/${data.parent}`,
            },
          });
        }
      }

      if (data.dependsOn !== undefined) {
        const currentDeps = new Set(extractPredecessors(current.relations));
        const newDeps = new Set(data.dependsOn);

        // Remove deps no longer in the list (iterate in reverse to preserve indices)
        const removeIndices: number[] = [];
        current.relations?.forEach((r, i) => {
          if (r.rel === 'System.LinkTypes.Dependency-Reverse') {
            const depId = r.url.match(/\/workitems\/(\d+)$/i)?.[1];
            if (depId && !newDeps.has(depId)) {
              removeIndices.push(i);
            }
          }
        });
        for (const idx of removeIndices.reverse()) {
          patch.push({ op: 'remove', path: `/relations/${idx}` });
        }

        // Add new deps
        for (const dep of newDeps) {
          if (!currentDeps.has(dep)) {
            patch.push({
              op: 'add',
              path: '/relations/-',
              value: {
                rel: 'System.LinkTypes.Dependency-Reverse',
                url: `https://dev.azure.com/${this.org}/_apis/wit/workitems/${dep}`,
              },
            });
          }
        }
      }
    }

    if (patch.length > 0) {
      await this.api.rest(
        'PATCH',
        `/_apis/wit/workitems/${id}`,
        patch,
        'application/json-patch+json',
      );
    }

    return this.getWorkItem(id);
  }

  async deleteWorkItem(id: string): Promise<void> {
    await this.api.rest('DELETE', `/_apis/wit/workitems/${id}`);
  }

  async addComment(workItemId: string, comment: NewComment): Promise<Comment> {
    await this.api.rest(
      'POST',
      `/${encodeURIComponent(this.project)}/_apis/wit/workItems/${workItemId}/comments?api-version=7.1-preview.4`,
      { text: comment.body },
    );

    return {
      author: comment.author,
      date: new Date().toISOString(),
      body: comment.body,
    };
  }

  override async getChildren(id: string): Promise<WorkItem[]> {
    const numericId = parseInt(id, 10);
    if (isNaN(numericId)) throw new Error(`Invalid work item ID: "${id}"`);

    const wiql = `SELECT [System.Id] FROM WorkItemLinks WHERE [Source].[System.Id] = ${numericId} AND [System.Links.LinkType] = 'System.LinkTypes.Hierarchy-Forward' MODE (MustContain)`;

    const queryResult = await this.api.wiql<{
      workItemRelations: { target: { id: number } }[];
    }>(this.project, wiql);

    const ids = queryResult.workItemRelations
      .map((r) => r.target.id)
      .filter((wid) => wid !== numericId);
    if (ids.length === 0) return [];

    return this.batchFetchWorkItems(ids);
  }

  override async getDependents(id: string): Promise<WorkItem[]> {
    const numericId = parseInt(id, 10);
    if (isNaN(numericId)) throw new Error(`Invalid work item ID: "${id}"`);

    const wiql = `SELECT [System.Id] FROM WorkItemLinks WHERE [Source].[System.Id] = ${numericId} AND [System.Links.LinkType] = 'System.LinkTypes.Dependency-Forward' MODE (MustContain)`;

    const queryResult = await this.api.wiql<{
      workItemRelations: { target: { id: number } }[];
    }>(this.project, wiql);

    const ids = queryResult.workItemRelations
      .map((r) => r.target.id)
      .filter((wid) => wid !== numericId);
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

  /* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */
  async listTemplates(): Promise<Template[]> {
    throw new UnsupportedOperationError('templates', 'AzureDevOpsBackend');
  }
  async getTemplate(_slug: string): Promise<Template> {
    throw new UnsupportedOperationError('templates', 'AzureDevOpsBackend');
  }
  async createTemplate(_template: Template): Promise<Template> {
    throw new UnsupportedOperationError('templates', 'AzureDevOpsBackend');
  }
  async updateTemplate(
    _oldSlug: string,
    _template: Template,
  ): Promise<Template> {
    throw new UnsupportedOperationError('templates', 'AzureDevOpsBackend');
  }
  async deleteTemplate(_slug: string): Promise<void> {
    throw new UnsupportedOperationError('templates', 'AzureDevOpsBackend');
  }
  /* eslint-enable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */
}
