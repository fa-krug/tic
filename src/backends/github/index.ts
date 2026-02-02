import { BaseBackend } from '../types.js';
import type { BackendCapabilities } from '../types.js';
import type {
  WorkItem,
  NewWorkItem,
  NewComment,
  Comment,
} from '../../types.js';
import { gh, ghExec, ghGraphQL } from './gh.js';
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

  constructor(cwd: string) {
    super();
    this.cwd = cwd;
    ghExec(['auth', 'status'], cwd);
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
      const { owner, repo } = this.getOwnerRepo();
      const collaborators = gh<{ login: string }[]>(
        ['api', `repos/${owner}/${repo}/collaborators`, '--jq', '.'],
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
    const { owner, repo } = this.getOwnerRepo();
    const allIssues: GhIssue[] = [];
    let cursor: string | null = null;

    do {
      const data: ListIssuesResponse = ghGraphQL<ListIssuesResponse>(
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

  // eslint-disable-next-line @typescript-eslint/require-await
  async getWorkItem(id: string): Promise<WorkItem> {
    const { owner, repo } = this.getOwnerRepo();
    const data = ghGraphQL<GetIssueResponse>(
      GET_ISSUE_QUERY,
      { owner, repo, number: Number(id) },
      this.cwd,
    );
    return mapIssueToWorkItem(data.repository.issue);
  }

  async createWorkItem(data: NewWorkItem): Promise<WorkItem> {
    this.validateFields(data);
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

    const output = ghExec(args, this.cwd);
    // gh issue create prints the URL: https://github.com/owner/repo/issues/123
    const match = output.match(/\/issues\/(\d+)/);
    if (!match) {
      throw new Error('Failed to parse issue number from gh output');
    }
    const id = match[1]!;

    if (data.parent) {
      this.addSubIssue(data.parent, id);
    }

    return this.getWorkItem(id);
  }

  async updateWorkItem(id: string, data: Partial<WorkItem>): Promise<WorkItem> {
    this.validateFields(data);

    // Handle parent changes via sub-issue mutations
    if (data.parent !== undefined) {
      const current = await this.getWorkItem(id);
      if (current.parent && current.parent !== data.parent) {
        this.removeSubIssue(current.parent, id);
      }
      if (data.parent && data.parent !== current.parent) {
        this.addSubIssue(data.parent, id);
      }
    }

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
    return (await this.listWorkItems()).filter((item) => item.parent === id);
  }

  async getDependents(id: string): Promise<WorkItem[]> {
    this.assertSupported(this.getCapabilities().fields.dependsOn, 'dependsOn');
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

  private getIssueNodeId(issueNumber: number): string {
    const { owner, repo } = this.getOwnerRepo();
    const data = ghGraphQL<GetIssueNodeIdResponse>(
      GET_ISSUE_NODE_ID_QUERY,
      { owner, repo, number: issueNumber },
      this.cwd,
    );
    return data.repository.issue.id;
  }

  private addSubIssue(parentNumber: string, childNumber: string): void {
    const parentId = this.getIssueNodeId(Number(parentNumber));
    const childId = this.getIssueNodeId(Number(childNumber));
    ghGraphQL(ADD_SUB_ISSUE_MUTATION, { parentId, childId }, this.cwd);
  }

  private removeSubIssue(parentNumber: string, childNumber: string): void {
    const parentId = this.getIssueNodeId(Number(parentNumber));
    const childId = this.getIssueNodeId(Number(childNumber));
    ghGraphQL(REMOVE_SUB_ISSUE_MUTATION, { parentId, childId }, this.cwd);
  }

  private getOwnerRepo(): { owner: string; repo: string } {
    if (!this.ownerRepo) {
      const nwo = this.getRepoNwo();
      const [owner, repo] = nwo.split('/');
      this.ownerRepo = { owner: owner!, repo: repo! };
    }
    return this.ownerRepo;
  }

  private fetchMilestones(): GhMilestone[] {
    const { owner, repo } = this.getOwnerRepo();
    return gh<GhMilestone[]>(
      ['api', `repos/${owner}/${repo}/milestones`, '--jq', '.'],
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
