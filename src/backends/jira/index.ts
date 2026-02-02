import { BaseBackend } from '../types.js';
import type { BackendCapabilities } from '../types.js';
import type {
  WorkItem,
  NewWorkItem,
  NewComment,
  Comment,
} from '../../types.js';
import { acli, acliExec } from './acli.js';
import { readJiraConfig } from './config.js';
import type { JiraConfig } from './config.js';
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

export class JiraBackend extends BaseBackend {
  private cwd: string;
  private config: JiraConfig;

  private cachedSprints: JiraSprint[] | null = null;

  private constructor(cwd: string, config: JiraConfig) {
    super(60_000);
    this.cwd = cwd;
    this.config = config;
  }

  protected override onCacheInvalidate(): void {
    this.cachedSprints = null;
  }

  static async create(cwd: string): Promise<JiraBackend> {
    acliExec(['jira', 'auth', 'status'], cwd);
    const config = await readJiraConfig(cwd);
    return new JiraBackend(cwd, config);
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
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getStatuses(): Promise<string[]> {
    const statuses = acli<{ name: string }[]>(
      [
        'jira',
        'project',
        'statuses',
        '--project',
        this.config.project,
        '--json',
      ],
      this.cwd,
    );
    return statuses.map((s) => s.name.toLowerCase());
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getWorkItemTypes(): Promise<string[]> {
    const project = acli<{ issueTypes: { name: string }[] }>(
      ['jira', 'project', 'view', '--project', this.config.project, '--json'],
      this.cwd,
    );
    return project.issueTypes.map((t) => t.name.toLowerCase());
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getAssignees(): Promise<string[]> {
    try {
      const users = acli<{ emailAddress: string }[]>(
        ['jira', 'user', 'search', '--project', this.config.project, '--json'],
        this.cwd,
      );
      return users.map((u) => u.emailAddress);
    } catch {
      return [];
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getIterations(): Promise<string[]> {
    if (!this.config.boardId) return [];
    const sprints = this.fetchSprints();
    return sprints.map((s) => s.name);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getCurrentIteration(): Promise<string> {
    if (!this.config.boardId) return '';
    const sprints = acli<JiraSprint[]>(
      [
        'jira',
        'board',
        'list-sprints',
        '--id',
        String(this.config.boardId),
        '--state',
        'active',
        '--json',
      ],
      this.cwd,
    );
    return sprints.length > 0 ? sprints[0]!.name : '';
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async setCurrentIteration(_name: string): Promise<void> {
    // No-op — current iteration is the active sprint
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async listWorkItems(iteration?: string): Promise<WorkItem[]> {
    if (iteration && this.config.boardId) {
      // Find the sprint ID for the given iteration name
      const sprints = this.fetchSprints();
      const sprint = sprints.find((s) => s.name === iteration);
      if (!sprint) return [];

      const issues = acli<JiraIssue[]>(
        [
          'jira',
          'workitem',
          'search',
          '--jql',
          `project = ${this.config.project} AND sprint = ${sprint.id}`,
          '--fields',
          '*all',
          '--paginate',
          '--json',
        ],
        this.cwd,
      );
      return issues.map(mapIssueToWorkItem);
    }

    const issues = acli<JiraIssue[]>(
      [
        'jira',
        'workitem',
        'search',
        '--jql',
        `project = ${this.config.project}`,
        '--fields',
        '*all',
        '--paginate',
        '--json',
      ],
      this.cwd,
    );
    let items = issues.map(mapIssueToWorkItem);
    if (iteration) {
      items = items.filter((i) => i.iteration === iteration);
    }
    return items;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getWorkItem(id: string): Promise<WorkItem> {
    const issue = acli<JiraIssue>(
      ['jira', 'workitem', 'view', '--key', id, '--fields', '*all', '--json'],
      this.cwd,
    );
    const item = mapIssueToWorkItem(issue);

    // Fetch comments separately
    try {
      const comments = acli<JiraComment[]>(
        ['jira', 'workitem', 'comment', 'list', '--key', id, '--json'],
        this.cwd,
      );
      item.comments = comments.map(mapCommentToComment);
    } catch {
      // Comments may fail — leave empty
    }

    return item;
  }

  async createWorkItem(data: NewWorkItem): Promise<WorkItem> {
    this.validateFields(data);

    const args = [
      'jira',
      'workitem',
      'create',
      '--project',
      this.config.project,
      '--type',
      titleCase(data.type),
      '--summary',
      data.title,
    ];

    if (data.description) {
      args.push('--description', data.description);
    }
    if (data.priority && data.priority !== 'medium') {
      args.push('--priority', mapPriorityToJira(data.priority));
    }
    if (data.assignee) {
      args.push('--assignee', data.assignee);
    }
    if (data.labels.length > 0) {
      args.push('--labels', data.labels.join(','));
    }
    if (data.parent) {
      args.push('--parent', data.parent);
    }

    args.push('--json');
    const result = acli<{ key: string }>(args, this.cwd);
    const key = result.key;

    // Create dependency links
    for (const dep of data.dependsOn) {
      acliExec(
        [
          'jira',
          'workitem',
          'link',
          'create',
          '--out',
          dep,
          '--in',
          key,
          '--type',
          'Blocks',
        ],
        this.cwd,
      );
    }

    this.invalidateCache();
    return this.getWorkItem(key);
  }

  async updateWorkItem(id: string, data: Partial<WorkItem>): Promise<WorkItem> {
    this.validateFields(data);

    // Handle status transition separately
    if (data.status !== undefined) {
      acliExec(
        [
          'jira',
          'workitem',
          'transition',
          '--key',
          id,
          '--status',
          titleCase(data.status),
          '--yes',
        ],
        this.cwd,
      );
    }

    // Handle assignee separately
    if (data.assignee !== undefined) {
      if (data.assignee) {
        acliExec(
          [
            'jira',
            'workitem',
            'assign',
            '--key',
            id,
            '--assignee',
            data.assignee,
          ],
          this.cwd,
        );
      } else {
        acliExec(
          ['jira', 'workitem', 'assign', '--key', id, '--remove-assignee'],
          this.cwd,
        );
      }
    }

    // Handle edit fields (title, description, labels, type)
    const editArgs = ['jira', 'workitem', 'edit', '--key', id];
    let hasEdits = false;

    if (data.title !== undefined) {
      editArgs.push('--summary', data.title);
      hasEdits = true;
    }
    if (data.description !== undefined) {
      editArgs.push('--description', data.description);
      hasEdits = true;
    }
    if (data.labels !== undefined) {
      editArgs.push('--labels', data.labels.join(','));
      hasEdits = true;
    }
    if (data.type !== undefined) {
      editArgs.push('--type', titleCase(data.type));
      hasEdits = true;
    }

    if (hasEdits) {
      acliExec(editArgs, this.cwd);
    }

    this.invalidateCache();
    return this.getWorkItem(id);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async deleteWorkItem(id: string): Promise<void> {
    acliExec(['jira', 'workitem', 'delete', '--key', id, '--yes'], this.cwd);
    this.invalidateCache();
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async addComment(workItemId: string, comment: NewComment): Promise<Comment> {
    acliExec(
      [
        'jira',
        'workitem',
        'comment',
        'create',
        '--key',
        workItemId,
        '--body',
        comment.body,
      ],
      this.cwd,
    );
    return {
      author: comment.author,
      date: new Date().toISOString(),
      body: comment.body,
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  override async getChildren(id: string): Promise<WorkItem[]> {
    const issues = acli<JiraIssue[]>(
      [
        'jira',
        'workitem',
        'search',
        '--jql',
        `parent = ${id}`,
        '--fields',
        '*all',
        '--paginate',
        '--json',
      ],
      this.cwd,
    );
    return issues.map(mapIssueToWorkItem);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  override async getDependents(id: string): Promise<WorkItem[]> {
    const issues = acli<JiraIssue[]>(
      [
        'jira',
        'workitem',
        'search',
        '--jql',
        `issue in linkedIssues("${id}","is blocked by")`,
        '--fields',
        '*all',
        '--paginate',
        '--json',
      ],
      this.cwd,
    );
    return issues.map(mapIssueToWorkItem);
  }

  getItemUrl(id: string): string {
    return `${this.config.site}/browse/${id}`;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async openItem(id: string): Promise<void> {
    acliExec(['jira', 'workitem', 'view', id, '--web'], this.cwd);
  }

  private fetchSprints(): JiraSprint[] {
    if (this.cachedSprints) return this.cachedSprints;
    this.cachedSprints = acli<JiraSprint[]>(
      [
        'jira',
        'board',
        'list-sprints',
        '--id',
        String(this.config.boardId),
        '--paginate',
        '--json',
      ],
      this.cwd,
    );
    return this.cachedSprints;
  }
}
