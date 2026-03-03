import { BaseBackend, UnsupportedOperationError } from '../types.js';
import type { BackendCapabilities } from '../types.js';
import type {
  WorkItem,
  NewWorkItem,
  NewComment,
  Comment,
  Template,
  Iteration,
} from '../../types.js';
import { JiraApiClient } from './api.js';
import { readJiraConfig } from './config.js';
import type { JiraConfig } from './config.js';
import { getJiraCredentials } from '../../auth/jira.js';
import { AuthError } from '../shared/api-client.js';
import {
  mapIssueToWorkItem,
  mapPriorityToJira,
  mapCommentToComment,
} from './mappers.js';
import type { JiraComment, JiraIssue, JiraSprint } from './mappers.js';

function titleCase(s: string): string {
  return s
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function normalizeSite(site: string): string {
  return site.replace(/^https?:\/\//, '');
}

/**
 * Escape a value for safe interpolation into a JQL query string.
 * Wraps in single quotes and doubles any embedded single quotes.
 */
export function escapeJqlValue(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export class JiraBackend extends BaseBackend {
  private config: JiraConfig;
  private api: JiraApiClient;

  private cachedSprints: JiraSprint[] | null = null;

  private constructor(config: JiraConfig, api: JiraApiClient) {
    super(60_000);
    this.config = config;
    this.api = api;
  }

  protected override onCacheInvalidate(): void {
    this.cachedSprints = null;
  }

  static async create(
    root: string,
    options?: { skipAuth?: boolean },
  ): Promise<JiraBackend> {
    const config = await readJiraConfig(root);
    const site = normalizeSite(config.site);
    const creds = getJiraCredentials(site);
    if (!creds) {
      throw new AuthError(
        `No Jira credentials found for ${site}. Run "tic auth login --backend jira" first.`,
      );
    }
    const api = new JiraApiClient(creds.email, creds.token, site);

    if (!options?.skipAuth) {
      await api.rest('GET', '/api/3/myself');
    }

    return new JiraBackend(config, api);
  }

  getCapabilities(): BackendCapabilities {
    return {
      relationships: true,
      customTypes: false,
      customStatuses: false,
      iterations: this.config.boardId != null,
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
      requiredFields: ['title', 'type'],
    };
  }

  async getStatuses(): Promise<string[]> {
    const groups = await this.api.rest<{ statuses: { name: string }[] }[]>(
      'GET',
      `/api/3/project/${this.config.project}/statuses`,
    );
    const seen = new Set<string>();
    const result: string[] = [];
    for (const group of groups) {
      for (const s of group.statuses) {
        const lower = s.name.toLowerCase();
        if (!seen.has(lower)) {
          seen.add(lower);
          result.push(lower);
        }
      }
    }
    return result;
  }

  async getWorkItemTypes(): Promise<string[]> {
    const project = await this.api.rest<{ issueTypes: { name: string }[] }>(
      'GET',
      `/api/3/project/${this.config.project}`,
    );
    return project.issueTypes.map((t) => t.name.toLowerCase());
  }

  async getAssignees(): Promise<string[]> {
    try {
      const users = await this.api.rest<{ emailAddress: string }[]>(
        'GET',
        `/api/3/user/assignable/search?project=${this.config.project}`,
      );
      return users.map((u) => u.emailAddress);
    } catch {
      return [];
    }
  }

  async getLabels(): Promise<string[]> {
    return this.getLabelsFromCache();
  }

  async getIterations(): Promise<Iteration[]> {
    if (!this.config.boardId) return [];
    const sprints = await this.fetchSprints();
    return sprints.map((s) => ({
      name: s.name,
      startDate: s.startDate?.split('T')[0] ?? null,
      endDate: s.endDate?.split('T')[0] ?? null,
    }));
  }

  async getCurrentIteration(): Promise<string> {
    if (!this.config.boardId) return '';
    const response = await this.api.rest<{ values: JiraSprint[] }>(
      'GET',
      `/agile/1.0/board/${this.config.boardId}/sprint?state=active`,
    );
    return response.values.length > 0 ? response.values[0]!.name : '';
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async setCurrentIteration(_name: string): Promise<void> {
    // No-op — current iteration is the active sprint
  }

  async listWorkItems(iteration?: string): Promise<WorkItem[]> {
    if (iteration && this.config.boardId) {
      // Find the sprint ID for the given iteration name
      const sprints = await this.fetchSprints();
      const sprint = sprints.find((s) => s.name === iteration);
      if (!sprint) return [];

      const issues = await this.collectPages<JiraIssue>(
        `/api/3/search?jql=${encodeURIComponent(`project = ${escapeJqlValue(this.config.project)} AND sprint = ${sprint.id}`)}&fields=*all`,
      );
      return issues.map(mapIssueToWorkItem);
    }

    const issues = await this.collectPages<JiraIssue>(
      `/api/3/search?jql=${encodeURIComponent(`project = ${escapeJqlValue(this.config.project)}`)}&fields=*all`,
    );
    let items = issues.map(mapIssueToWorkItem);
    if (iteration) {
      items = items.filter((i) => i.iteration === iteration);
    }
    return items;
  }

  async getWorkItem(id: string): Promise<WorkItem> {
    const issue = await this.api.rest<JiraIssue>(
      'GET',
      `/api/3/issue/${id}?fields=*all`,
    );
    const item = mapIssueToWorkItem(issue);

    // Fetch comments separately
    try {
      const response = await this.api.rest<{ comments: JiraComment[] }>(
        'GET',
        `/api/3/issue/${id}/comment`,
      );
      item.comments = response.comments.map(mapCommentToComment);
    } catch {
      // Comments may fail — leave empty
    }

    return item;
  }

  async createWorkItem(data: NewWorkItem): Promise<WorkItem> {
    this.validateFields(data);

    const fields: Record<string, unknown> = {
      project: { key: this.config.project },
      issuetype: { name: titleCase(data.type) },
      summary: data.title,
    };

    if (data.description) {
      fields['description'] = {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: data.description }],
          },
        ],
      };
    }
    if (data.priority && data.priority !== 'medium') {
      fields['priority'] = { name: mapPriorityToJira(data.priority) };
    }
    if (data.assignee) {
      fields['assignee'] = { id: data.assignee };
    }
    if (data.labels.length > 0) {
      fields['labels'] = data.labels;
    }
    if (data.parent) {
      fields['parent'] = { key: data.parent };
    }

    const result = await this.api.rest<{ key: string }>(
      'POST',
      '/api/3/issue',
      {
        fields,
      },
    );
    const key = result.key;

    // Create dependency links
    if (data.dependsOn.length > 0) {
      try {
        for (const dep of data.dependsOn) {
          await this.api.rest('POST', '/api/3/issueLink', {
            type: { name: 'Blocks' },
            inwardIssue: { key },
            outwardIssue: { key: dep },
          });
        }
      } catch (err) {
        try {
          await this.api.rest('DELETE', `/api/3/issue/${key}`);
        } catch {
          // Best-effort cleanup
        }
        this.invalidateCache();
        throw new Error(
          `Failed to create dependency links for ${key}; issue was rolled back: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    this.invalidateCache();
    return this.getWorkItem(key);
  }

  async updateWorkItem(id: string, data: Partial<WorkItem>): Promise<WorkItem> {
    this.validateFields(data);

    // Handle status transition separately — must look up transition ID
    if (data.status !== undefined) {
      const transitionsResponse = await this.api.rest<{
        transitions: { id: string; name: string }[];
      }>('GET', `/api/3/issue/${id}/transitions`);

      const target = titleCase(data.status);
      const transition = transitionsResponse.transitions.find(
        (t) => t.name === target,
      );
      if (transition) {
        await this.api.rest('POST', `/api/3/issue/${id}/transitions`, {
          transition: { id: transition.id },
        });
      } else {
        throw new Error(
          `No transition found to status "${target}". Available: ${transitionsResponse.transitions.map((t) => t.name).join(', ')}`,
        );
      }
    }

    // Handle edit fields (title, description, labels, type, assignee)
    const fields: Record<string, unknown> = {};
    let hasEdits = false;

    if (data.title !== undefined) {
      fields['summary'] = data.title;
      hasEdits = true;
    }
    if (data.description !== undefined) {
      fields['description'] = data.description
        ? {
            type: 'doc',
            version: 1,
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: data.description }],
              },
            ],
          }
        : null;
      hasEdits = true;
    }
    if (data.labels !== undefined) {
      fields['labels'] = data.labels;
      hasEdits = true;
    }
    if (data.type !== undefined) {
      fields['issuetype'] = { name: titleCase(data.type) };
      hasEdits = true;
    }
    if (data.assignee !== undefined) {
      fields['assignee'] = data.assignee ? { id: data.assignee } : null;
      hasEdits = true;
    }
    if (data.priority !== undefined) {
      fields['priority'] = { name: mapPriorityToJira(data.priority) };
      hasEdits = true;
    }

    if (hasEdits) {
      await this.api.rest('PUT', `/api/3/issue/${id}`, { fields });
    }

    this.invalidateCache();
    return this.getWorkItem(id);
  }

  async deleteWorkItem(id: string): Promise<void> {
    await this.api.rest('DELETE', `/api/3/issue/${id}`);
    this.invalidateCache();
  }

  async addComment(workItemId: string, comment: NewComment): Promise<Comment> {
    await this.api.rest('POST', `/api/3/issue/${workItemId}/comment`, {
      body: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: comment.body }],
          },
        ],
      },
    });
    return {
      author: comment.author,
      date: new Date().toISOString(),
      body: comment.body,
    };
  }

  override async getChildren(id: string): Promise<WorkItem[]> {
    const issues = await this.collectPages<JiraIssue>(
      `/api/3/search?jql=${encodeURIComponent(`parent = ${id}`)}&fields=*all`,
    );
    return issues.map(mapIssueToWorkItem);
  }

  override async getDependents(id: string): Promise<WorkItem[]> {
    const issues = await this.collectPages<JiraIssue>(
      `/api/3/search?jql=${encodeURIComponent(`issue in linkedIssues("${id}","is blocked by")`)}&fields=*all`,
    );
    return issues.map(mapIssueToWorkItem);
  }

  getItemUrl(id: string): string {
    return `${this.config.site}/browse/${id}`;
  }

  async openItem(id: string): Promise<void> {
    const openModule = await import('open');
    await openModule.default(this.getItemUrl(id));
  }

  /* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */
  async listTemplates(): Promise<Template[]> {
    throw new UnsupportedOperationError('templates', 'JiraBackend');
  }
  async getTemplate(_slug: string): Promise<Template> {
    throw new UnsupportedOperationError('templates', 'JiraBackend');
  }
  async createTemplate(_template: Template): Promise<Template> {
    throw new UnsupportedOperationError('templates', 'JiraBackend');
  }
  async updateTemplate(
    _oldSlug: string,
    _template: Template,
  ): Promise<Template> {
    throw new UnsupportedOperationError('templates', 'JiraBackend');
  }
  async deleteTemplate(_slug: string): Promise<void> {
    throw new UnsupportedOperationError('templates', 'JiraBackend');
  }
  /* eslint-enable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */

  private async fetchSprints(): Promise<JiraSprint[]> {
    if (this.cachedSprints) return this.cachedSprints;
    const response = await this.api.rest<{ values: JiraSprint[] }>(
      'GET',
      `/agile/1.0/board/${this.config.boardId}/sprint`,
    );
    this.cachedSprints = response.values;
    return this.cachedSprints;
  }

  private async collectPages<T>(path: string): Promise<T[]> {
    const all: T[] = [];
    for await (const page of this.api.paginate<T>(path)) {
      all.push(...page);
    }
    return all;
  }
}
