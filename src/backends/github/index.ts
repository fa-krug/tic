import { BaseBackend } from '../types.js';
import type { BackendCapabilities } from '../types.js';
import type {
  WorkItem,
  NewWorkItem,
  NewComment,
  Comment,
} from '../../types.js';
import { gh, ghExec } from './gh.js';
import { mapIssueToWorkItem } from './mappers.js';
import type { GhIssue, GhMilestone } from './mappers.js';

const ISSUE_FIELDS =
  'number,title,body,state,assignees,labels,milestone,createdAt,updatedAt,comments';

export class GitHubBackend extends BaseBackend {
  private cwd: string;

  constructor(cwd: string) {
    super();
    this.cwd = cwd;
    ghExec(['auth', 'status'], cwd);
  }

  getCapabilities(): BackendCapabilities {
    return {
      relationships: false,
      customTypes: false,
      customStatuses: false,
      iterations: true,
      comments: true,
      fields: {
        priority: false,
        assignee: true,
        labels: true,
        parent: false,
        dependsOn: false,
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getStatuses(): Promise<string[]> {
    return ['open', 'closed'];
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getWorkItemTypes(): Promise<string[]> {
    return ['issue'];
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getAssignees(): Promise<string[]> {
    try {
      const owner = this.getRepoNwo();
      const collaborators = gh<{ login: string }[]>(
        ['api', `repos/${owner}/collaborators`, '--jq', '.'],
        this.cwd,
      );
      return collaborators.map((c) => c.login);
    } catch {
      return [];
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getIterations(): Promise<string[]> {
    const milestones = this.fetchMilestones();
    return milestones.map((m) => m.title);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getCurrentIteration(): Promise<string> {
    const milestones = this.fetchOpenMilestones();
    if (milestones.length === 0) return '';
    return milestones[0]!.title;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async setCurrentIteration(_name: string): Promise<void> {
    // No-op — current iteration is always first open milestone
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async listWorkItems(iteration?: string): Promise<WorkItem[]> {
    const args = [
      'issue',
      'list',
      '--state',
      'all',
      '--json',
      ISSUE_FIELDS,
      '--limit',
      '500',
    ];
    if (iteration) {
      args.push('--milestone', iteration);
    }
    const issues = gh<GhIssue[]>(args, this.cwd);
    return issues.map(mapIssueToWorkItem);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getWorkItem(id: string): Promise<WorkItem> {
    const issue = gh<GhIssue>(
      ['issue', 'view', id, '--json', ISSUE_FIELDS],
      this.cwd,
    );
    return mapIssueToWorkItem(issue);
  }

  async createWorkItem(data: NewWorkItem): Promise<WorkItem> {
    this.validateFields(data);
    const args = ['issue', 'create', '--title', data.title];

    if (data.description) {
      args.push('--body', data.description);
    }
    if (data.assignee) {
      args.push('--assignee', data.assignee);
    }
    if (data.iteration) {
      args.push('--milestone', data.iteration);
    }
    for (const label of data.labels) {
      args.push('--label', label);
    }

    const output = ghExec(args, this.cwd);
    // gh issue create prints the URL: https://github.com/owner/repo/issues/123
    const match = output.match(/\/issues\/(\d+)/);
    if (!match) {
      throw new Error('Failed to parse issue number from gh output');
    }
    const id = match[1]!;
    return this.getWorkItem(id);
  }

  async updateWorkItem(id: string, data: Partial<WorkItem>): Promise<WorkItem> {
    this.validateFields(data);

    // Handle status changes via close/reopen
    if (data.status === 'closed') {
      ghExec(['issue', 'close', id], this.cwd);
    } else if (data.status === 'open') {
      ghExec(['issue', 'reopen', id], this.cwd);
    }

    // Handle field edits
    const editArgs = ['issue', 'edit', id];
    let hasEdits = false;

    if (data.title !== undefined) {
      editArgs.push('--title', data.title);
      hasEdits = true;
    }
    if (data.description !== undefined) {
      editArgs.push('--body', data.description);
      hasEdits = true;
    }
    if (data.iteration !== undefined) {
      if (data.iteration) {
        editArgs.push('--milestone', data.iteration);
      } else {
        editArgs.push('--remove-milestone');
      }
      hasEdits = true;
    }
    if (data.assignee !== undefined) {
      if (data.assignee) {
        editArgs.push('--add-assignee', data.assignee);
      }
      hasEdits = true;
    }
    if (data.labels !== undefined) {
      for (const label of data.labels) {
        editArgs.push('--add-label', label);
      }
      hasEdits = true;
    }

    if (hasEdits) {
      ghExec(editArgs, this.cwd);
    }

    return this.getWorkItem(id);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async deleteWorkItem(id: string): Promise<void> {
    ghExec(['issue', 'delete', id, '--yes'], this.cwd);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async addComment(workItemId: string, comment: NewComment): Promise<Comment> {
    ghExec(['issue', 'comment', workItemId, '--body', comment.body], this.cwd);
    return {
      author: comment.author,
      date: new Date().toISOString(),
      body: comment.body,
    };
  }

  async getChildren(id: string): Promise<WorkItem[]> {
    this.assertSupported(this.getCapabilities().relationships, 'relationships');
    return (await this.listWorkItems()).filter((item) => item.parent === id);
  }

  async getDependents(id: string): Promise<WorkItem[]> {
    this.assertSupported(this.getCapabilities().relationships, 'relationships');
    return (await this.listWorkItems()).filter((item) =>
      item.dependsOn.includes(id),
    );
  }

  getItemUrl(id: string): string {
    const result = gh<{ url: string }>(
      ['issue', 'view', id, '--json', 'url'],
      this.cwd,
    );
    return result.url;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async openItem(id: string): Promise<void> {
    ghExec(['issue', 'view', id, '--web'], this.cwd);
  }

  private fetchMilestones(): GhMilestone[] {
    const owner = this.getRepoNwo();
    return gh<GhMilestone[]>(
      ['api', `repos/${owner}/milestones`, '--jq', '.'],
      this.cwd,
    );
  }

  private fetchOpenMilestones(): GhMilestone[] {
    const milestones = this.fetchMilestones();
    return milestones
      .filter((m) => m.state === 'open')
      .sort((a, b) => {
        if (!a.due_on && !b.due_on) return 0;
        if (!a.due_on) return 1;
        if (!b.due_on) return -1;
        return a.due_on.localeCompare(b.due_on);
      });
  }

  private getRepoNwo(): string {
    const result = gh<{ nameWithOwner: string }>(
      ['repo', 'view', '--json', 'nameWithOwner'],
      this.cwd,
    );
    return result.nameWithOwner;
  }
}
