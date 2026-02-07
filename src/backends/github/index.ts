import { BaseBackend, UnsupportedOperationError } from '../types.js';
import type { BackendCapabilities } from '../types.js';
import type {
  WorkItem,
  NewWorkItem,
  NewComment,
  Comment,
  Template,
} from '../../types.js';
import { gh, ghExec, ghGraphQL, ghExecSync, ghSync } from './gh.js';
import { mapIssueToWorkItem } from './mappers.js';
import type { GhIssue, GhMilestone } from './mappers.js';

const LIST_ISSUES_QUERY = `
  query($owner: String!, $repo: String!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      issues(first: 100, after: $cursor, states: [OPEN, CLOSED]) {
        nodes {
          number title body state
          assignees(first: 10) { nodes { login } }
          labels(first: 20) { nodes { name } }
          milestone { title }
          createdAt updatedAt
          comments(first: 100) { nodes { author { login } createdAt body } }
          parent { number }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

const GET_ISSUE_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        number title body state
        assignees(first: 10) { nodes { login } }
        labels(first: 20) { nodes { name } }
        milestone { title }
        createdAt updatedAt
        comments(first: 100) { nodes { author { login } createdAt body } }
        parent { number }
      }
    }
  }
`;

const GET_ISSUE_NODE_ID_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) { id }
    }
  }
`;

const ADD_SUB_ISSUE_MUTATION = `
  mutation($parentId: ID!, $childId: ID!) {
    addSubIssue(input: { issueId: $parentId, subIssueId: $childId }) {
      issue { title }
      subIssue { title }
    }
  }
`;

const REMOVE_SUB_ISSUE_MUTATION = `
  mutation($parentId: ID!, $childId: ID!) {
    removeSubIssue(input: { issueId: $parentId, subIssueId: $childId }) {
      issue { title }
      subIssue { title }
    }
  }
`;

interface ListIssuesResponse {
  repository: {
    issues: {
      nodes: GhIssue[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };
}

interface GetIssueResponse {
  repository: {
    issue: GhIssue;
  };
}

interface GetIssueNodeIdResponse {
  repository: {
    issue: { id: string };
  };
}

export class GitHubBackend extends BaseBackend {
  private cwd: string;
  private ownerRepo: { owner: string; repo: string } | null = null;
  private cachedMilestones: GhMilestone[] | null = null;

  constructor(cwd: string) {
    super(60_000);
    this.cwd = cwd;
    ghExecSync(['auth', 'status'], cwd);
  }

  protected override onCacheInvalidate(): void {
    this.cachedMilestones = null;
  }

  getCapabilities(): BackendCapabilities {
    return {
      relationships: true,
      customTypes: false,
      customStatuses: false,
      iterations: true,
      comments: true,
      fields: {
        priority: false,
        assignee: true,
        labels: true,
        parent: true,
        dependsOn: false,
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
    return ['open', 'closed'];
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getWorkItemTypes(): Promise<string[]> {
    return ['issue'];
  }

  async getAssignees(): Promise<string[]> {
    try {
      const { owner, repo } = await this.getOwnerRepo();
      const collaborators = await gh<{ login: string }[]>(
        ['api', `repos/${owner}/${repo}/collaborators`, '--jq', '.'],
        this.cwd,
      );
      return collaborators.map((c) => c.login);
    } catch {
      return [];
    }
  }

  async getLabels(): Promise<string[]> {
    return this.getLabelsFromCache();
  }

  async getIterations(): Promise<string[]> {
    const milestones = await this.fetchMilestones();
    return milestones.map((m) => m.title);
  }

  async getCurrentIteration(): Promise<string> {
    const milestones = await this.fetchOpenMilestones();
    if (milestones.length === 0) return '';
    return milestones[0]!.title;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async setCurrentIteration(_name: string): Promise<void> {
    // No-op — current iteration is always first open milestone
  }

  async listWorkItems(iteration?: string): Promise<WorkItem[]> {
    const { owner, repo } = await this.getOwnerRepo();
    const allIssues: GhIssue[] = [];
    let cursor: string | null = null;

    do {
      const data: ListIssuesResponse = await ghGraphQL<ListIssuesResponse>(
        LIST_ISSUES_QUERY,
        { owner, repo, cursor },
        this.cwd,
      );
      allIssues.push(...data.repository.issues.nodes);
      cursor = data.repository.issues.pageInfo.hasNextPage
        ? data.repository.issues.pageInfo.endCursor
        : null;
    } while (cursor !== null);

    let items = allIssues.map(mapIssueToWorkItem);
    if (iteration) {
      items = items.filter((i) => i.iteration === iteration);
    }
    return items;
  }

  async getWorkItem(id: string): Promise<WorkItem> {
    const { owner, repo } = await this.getOwnerRepo();
    const data = await ghGraphQL<GetIssueResponse>(
      GET_ISSUE_QUERY,
      { owner, repo, number: Number(id) },
      this.cwd,
    );
    return mapIssueToWorkItem(data.repository.issue);
  }

  private async ensureLabels(labels: string[]): Promise<void> {
    for (const label of labels) {
      try {
        await ghExec(['label', 'create', label], this.cwd);
      } catch {
        // Label already exists — ignore
      }
    }
  }

  async createWorkItem(data: NewWorkItem): Promise<WorkItem> {
    this.validateFields(data);
    if (data.labels.length > 0) {
      await this.ensureLabels(data.labels);
    }
    const args = [
      'issue',
      'create',
      '--title',
      data.title,
      '--body',
      data.description || '',
    ];
    if (data.assignee) {
      args.push('--assignee', data.assignee);
    }
    if (data.iteration) {
      args.push('--milestone', data.iteration);
    }
    for (const label of data.labels) {
      args.push('--label', label);
    }

    const output = await ghExec(args, this.cwd);
    // gh issue create prints the URL: https://github.com/owner/repo/issues/123
    const match = output.match(/\/issues\/(\d+)/);
    if (!match) {
      throw new Error('Failed to parse issue number from gh output');
    }
    const id = match[1]!;

    if (data.parent) {
      try {
        await this.addSubIssue(data.parent, id);
      } catch (err) {
        try {
          await ghExec(['issue', 'delete', id, '--yes'], this.cwd);
        } catch {
          // Best-effort cleanup
        }
        throw new Error(
          `Failed to link parent #${data.parent} to issue #${id}; issue was rolled back: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return this.getWorkItem(id);
  }

  async updateWorkItem(id: string, data: Partial<WorkItem>): Promise<WorkItem> {
    this.validateFields(data);
    if (data.labels !== undefined && data.labels.length > 0) {
      await this.ensureLabels(data.labels);
    }

    // Handle parent changes via sub-issue mutations
    if (data.parent !== undefined) {
      const current = await this.getWorkItem(id);
      try {
        if (current.parent && current.parent !== data.parent) {
          await this.removeSubIssue(current.parent, id);
        }
        if (data.parent && data.parent !== current.parent) {
          await this.addSubIssue(data.parent, id);
        }
      } catch (err) {
        throw new Error(
          `Failed to update parent relationship for issue #${id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Handle status changes via close/reopen
    if (data.status === 'closed') {
      await ghExec(['issue', 'close', id], this.cwd);
    } else if (data.status === 'open') {
      await ghExec(['issue', 'reopen', id], this.cwd);
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
      await ghExec(editArgs, this.cwd);
    }

    return this.getWorkItem(id);
  }

  async deleteWorkItem(id: string): Promise<void> {
    await ghExec(['issue', 'delete', id, '--yes'], this.cwd);
  }

  async addComment(workItemId: string, comment: NewComment): Promise<Comment> {
    await ghExec(
      ['issue', 'comment', workItemId, '--body', comment.body],
      this.cwd,
    );
    return {
      author: comment.author,
      date: new Date().toISOString(),
      body: comment.body,
    };
  }

  getItemUrl(id: string): string {
    const result = ghSync<{ url: string }>(
      ['issue', 'view', id, '--json', 'url'],
      this.cwd,
    );
    return result.url;
  }

  async openItem(id: string): Promise<void> {
    await ghExec(['issue', 'view', id, '--web'], this.cwd);
  }

  /* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */
  async listTemplates(): Promise<Template[]> {
    throw new UnsupportedOperationError('templates', 'GitHubBackend');
  }
  async getTemplate(_slug: string): Promise<Template> {
    throw new UnsupportedOperationError('templates', 'GitHubBackend');
  }
  async createTemplate(_template: Template): Promise<Template> {
    throw new UnsupportedOperationError('templates', 'GitHubBackend');
  }
  async updateTemplate(
    _oldSlug: string,
    _template: Template,
  ): Promise<Template> {
    throw new UnsupportedOperationError('templates', 'GitHubBackend');
  }
  async deleteTemplate(_slug: string): Promise<void> {
    throw new UnsupportedOperationError('templates', 'GitHubBackend');
  }
  /* eslint-enable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */

  private async getIssueNodeId(issueNumber: number): Promise<string> {
    const { owner, repo } = await this.getOwnerRepo();
    const data = await ghGraphQL<GetIssueNodeIdResponse>(
      GET_ISSUE_NODE_ID_QUERY,
      { owner, repo, number: issueNumber },
      this.cwd,
    );
    return data.repository.issue.id;
  }

  private async addSubIssue(
    parentNumber: string,
    childNumber: string,
  ): Promise<void> {
    const parentId = await this.getIssueNodeId(Number(parentNumber));
    const childId = await this.getIssueNodeId(Number(childNumber));
    await ghGraphQL(ADD_SUB_ISSUE_MUTATION, { parentId, childId }, this.cwd);
  }

  private async removeSubIssue(
    parentNumber: string,
    childNumber: string,
  ): Promise<void> {
    const parentId = await this.getIssueNodeId(Number(parentNumber));
    const childId = await this.getIssueNodeId(Number(childNumber));
    await ghGraphQL(REMOVE_SUB_ISSUE_MUTATION, { parentId, childId }, this.cwd);
  }

  private async getOwnerRepo(): Promise<{ owner: string; repo: string }> {
    if (!this.ownerRepo) {
      const nwo = await this.getRepoNwo();
      const [owner, repo] = nwo.split('/');
      this.ownerRepo = { owner: owner!, repo: repo! };
    }
    return this.ownerRepo;
  }

  private async fetchMilestones(): Promise<GhMilestone[]> {
    if (this.cachedMilestones) return this.cachedMilestones;
    const { owner, repo } = await this.getOwnerRepo();
    this.cachedMilestones = await gh<GhMilestone[]>(
      ['api', `repos/${owner}/${repo}/milestones`, '--jq', '.'],
      this.cwd,
    );
    return this.cachedMilestones;
  }

  private async fetchOpenMilestones(): Promise<GhMilestone[]> {
    const milestones = await this.fetchMilestones();
    return milestones
      .filter((m) => m.state === 'open')
      .sort((a, b) => {
        if (!a.due_on && !b.due_on) return 0;
        if (!a.due_on) return 1;
        if (!b.due_on) return -1;
        return a.due_on.localeCompare(b.due_on);
      });
  }

  private async getRepoNwo(): Promise<string> {
    const result = await gh<{ nameWithOwner: string }>(
      ['repo', 'view', '--json', 'nameWithOwner'],
      this.cwd,
    );
    return result.nameWithOwner;
  }
}
