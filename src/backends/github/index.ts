import { execSync } from 'node:child_process';
import open from 'open';
import { BaseBackend, UnsupportedOperationError } from '../types.js';
import type {
  BackendCapabilities,
  PrBackend,
  PrCapabilities,
} from '../types.js';
import type {
  WorkItem,
  NewWorkItem,
  NewComment,
  Comment,
  Template,
  PullRequest,
  NewPullRequest,
  Iteration,
} from '../../types.js';
import { getGitHubToken, authenticateGitHub } from '../../auth/github.js';
import { AuthError } from '../shared/api-client.js';
import { GitHubApiClient } from './api.js';
export type { GitHubApiClient } from './api.js';
import { mapIssueToWorkItem } from './mappers.js';
import type { GhIssue, GhMilestone } from './mappers.js';
import { mapGhPrToPullRequest } from './pr-mappers.js';
import type { GhPullRequest } from './pr-mappers.js';

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

const DELETE_ISSUE_MUTATION = `
  mutation($issueId: ID!) {
    deleteIssue(input: { issueId: $issueId }) {
      repository { name }
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

interface CreateIssueBody {
  title: string;
  body: string;
  assignees?: string[];
  labels?: string[];
  milestone?: number;
}

interface PatchIssueBody {
  state?: string;
  title?: string;
  body?: string;
  assignees?: string[];
  labels?: string[];
  milestone?: number | null;
}

export interface GitHubBackendOptions {
  skipAuth?: boolean;
}

export class GitHubBackend extends BaseBackend implements PrBackend {
  private api: GitHubApiClient;
  private owner: string;
  private repo: string;
  private cachedMilestones: GhMilestone[] | null = null;

  private constructor(api: GitHubApiClient, owner: string, repo: string) {
    super(60_000);
    this.api = api;
    this.owner = owner;
    this.repo = repo;
  }

  static async create(
    cwd: string,
    options?: GitHubBackendOptions,
  ): Promise<GitHubBackend> {
    const { owner, repo } = GitHubBackend.detectOwnerRepo(cwd);
    let token = getGitHubToken();
    if (!token) {
      if (options?.skipAuth) {
        throw new AuthError(
          'GitHub authentication required. Run "tic auth login github" to authenticate.',
        );
      }
      token = await authenticateGitHub({
        onCode: (code, url) => {
          console.log(`\nGitHub authentication required.`);
          console.log(`Visit ${url} and enter code: ${code}\n`);
        },
      });
    }
    const api = new GitHubApiClient(token);
    return new GitHubBackend(api, owner, repo);
  }

  private static detectOwnerRepo(cwd: string): {
    owner: string;
    repo: string;
  } {
    const output = execSync('git remote -v', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const match = output.match(
      /github\.com[:/]([^/\s]+)\/([^/\s.]+?)(?:\.git)?(?:\s|$)/,
    );
    if (!match) {
      throw new Error('Could not detect GitHub owner/repo from git remotes');
    }
    return { owner: match[1]!, repo: match[2]! };
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
      requiredFields: ['title'],
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getStatuses(): Promise<string[]> {
    return ['open', 'closed'];
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  override async getClosedStatuses(): Promise<string[]> {
    return ['closed'];
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getWorkItemTypes(): Promise<string[]> {
    return ['issue'];
  }

  async getAssignees(): Promise<string[]> {
    try {
      const collaborators: { login: string }[] = [];
      for await (const page of this.api.paginate<{ login: string }>(
        `/repos/${this.owner}/${this.repo}/collaborators`,
      )) {
        collaborators.push(...page);
      }
      return collaborators.map((c) => c.login);
    } catch {
      return [];
    }
  }

  async getLabels(): Promise<string[]> {
    return this.getLabelsFromCache();
  }

  async getIterations(): Promise<Iteration[]> {
    const milestones = await this.fetchMilestones();
    return milestones.map((m) => ({
      name: m.title,
      startDate: null,
      endDate: m.due_on ? m.due_on.split('T')[0]! : null,
    }));
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
    const allIssues: GhIssue[] = [];
    let cursor: string | null = null;

    do {
      const data: ListIssuesResponse =
        await this.api.graphql<ListIssuesResponse>(LIST_ISSUES_QUERY, {
          owner: this.owner,
          repo: this.repo,
          cursor,
        });
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
    const data = await this.api.graphql<GetIssueResponse>(GET_ISSUE_QUERY, {
      owner: this.owner,
      repo: this.repo,
      number: Number(id),
    });
    return mapIssueToWorkItem(data.repository.issue);
  }

  private async ensureLabels(labels: string[]): Promise<void> {
    for (const label of labels) {
      try {
        await this.api.rest(
          'POST',
          `/repos/${this.owner}/${this.repo}/labels`,
          { name: label },
        );
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

    const issueBody: CreateIssueBody = {
      title: data.title,
      body: data.description || '',
    };

    if (data.assignee) {
      issueBody.assignees = [data.assignee];
    }
    if (data.labels.length > 0) {
      issueBody.labels = data.labels;
    }
    if (data.iteration) {
      const milestones = await this.fetchMilestones();
      const milestone = milestones.find((m) => m.title === data.iteration);
      if (milestone) {
        issueBody.milestone = milestone.number;
      }
    }

    const result = await this.api.rest<{ number: number }>(
      'POST',
      `/repos/${this.owner}/${this.repo}/issues`,
      issueBody,
    );
    const id = String(result.number);

    if (data.parent) {
      try {
        await this.addSubIssue(data.parent, id);
      } catch (err) {
        try {
          await this.deleteWorkItem(id);
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

    // Build PATCH body for REST API
    const patchBody: PatchIssueBody = {};
    let hasPatch = false;

    if (data.status !== undefined) {
      patchBody.state = data.status === 'closed' ? 'closed' : 'open';
      hasPatch = true;
    }
    if (data.title !== undefined) {
      patchBody.title = data.title;
      hasPatch = true;
    }
    if (data.description !== undefined) {
      patchBody.body = data.description;
      hasPatch = true;
    }
    if (data.iteration !== undefined) {
      if (data.iteration) {
        const milestones = await this.fetchMilestones();
        const milestone = milestones.find((m) => m.title === data.iteration);
        if (milestone) {
          patchBody.milestone = milestone.number;
        }
      } else {
        patchBody.milestone = null;
      }
      hasPatch = true;
    }
    if (data.assignee !== undefined) {
      if (data.assignee) {
        patchBody.assignees = [data.assignee];
      } else {
        patchBody.assignees = [];
      }
      hasPatch = true;
    }
    if (data.labels !== undefined) {
      patchBody.labels = data.labels;
      hasPatch = true;
    }

    if (hasPatch) {
      await this.api.rest(
        'PATCH',
        `/repos/${this.owner}/${this.repo}/issues/${id}`,
        patchBody,
      );
    }

    return this.getWorkItem(id);
  }

  async deleteWorkItem(id: string): Promise<void> {
    const nodeId = await this.getIssueNodeId(Number(id));
    await this.api.graphql(DELETE_ISSUE_MUTATION, { issueId: nodeId });
  }

  async addComment(workItemId: string, comment: NewComment): Promise<Comment> {
    await this.api.rest(
      'POST',
      `/repos/${this.owner}/${this.repo}/issues/${workItemId}/comments`,
      { body: comment.body },
    );
    return {
      author: comment.author,
      date: new Date().toISOString(),
      body: comment.body,
    };
  }

  getItemUrl(id: string): string {
    return `https://github.com/${this.owner}/${this.repo}/issues/${id}`;
  }

  async openItem(id: string): Promise<void> {
    const url = this.getItemUrl(id);
    await open(url);
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

  // --- PrBackend implementation ---

  getPrCapabilities(): PrCapabilities {
    return { pullRequests: true, merge: true, create: true };
  }

  async listPullRequests(): Promise<PullRequest[]> {
    const allPrs: GhPullRequest[] = [];
    for await (const page of this.api.paginate<GhPullRequest>(
      `/repos/${this.owner}/${this.repo}/pulls?state=all`,
    )) {
      allPrs.push(...page);
    }
    return allPrs.map(mapGhPrToPullRequest);
  }

  async getPullRequest(id: string): Promise<PullRequest | null> {
    const num = Number(id.replace('pr-', ''));
    try {
      const gh = await this.api.rest<GhPullRequest>(
        'GET',
        `/repos/${this.owner}/${this.repo}/pulls/${num}`,
      );
      return mapGhPrToPullRequest(gh);
    } catch {
      return null;
    }
  }

  async createPullRequest(pr: NewPullRequest): Promise<PullRequest> {
    const gh = await this.api.rest<GhPullRequest>(
      'POST',
      `/repos/${this.owner}/${this.repo}/pulls`,
      {
        title: pr.title,
        body: pr.description || '',
        head: pr.sourceBranch,
        base: pr.targetBranch || 'main',
      },
    );
    return mapGhPrToPullRequest(gh);
  }

  async updatePullRequest(
    id: string,
    updates: Partial<NewPullRequest>,
  ): Promise<PullRequest> {
    const num = Number(id.replace('pr-', ''));
    const body: Record<string, unknown> = {};
    if (updates.title !== undefined) body['title'] = updates.title;
    if (updates.description !== undefined) body['body'] = updates.description;
    const gh = await this.api.rest<GhPullRequest>(
      'PATCH',
      `/repos/${this.owner}/${this.repo}/pulls/${num}`,
      body,
    );
    return mapGhPrToPullRequest(gh);
  }

  async mergePullRequest(id: string): Promise<PullRequest> {
    const num = Number(id.replace('pr-', ''));
    await this.api.rest(
      'PUT',
      `/repos/${this.owner}/${this.repo}/pulls/${num}/merge`,
      {},
    );
    // Re-fetch to get updated status
    const gh = await this.api.rest<GhPullRequest>(
      'GET',
      `/repos/${this.owner}/${this.repo}/pulls/${num}`,
    );
    return mapGhPrToPullRequest(gh);
  }

  async closePullRequest(id: string): Promise<PullRequest> {
    const num = Number(id.replace('pr-', ''));
    const gh = await this.api.rest<GhPullRequest>(
      'PATCH',
      `/repos/${this.owner}/${this.repo}/pulls/${num}`,
      { state: 'closed' },
    );
    return mapGhPrToPullRequest(gh);
  }

  // These delegate to Storage (local), not GitHub API
  /* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */
  async getLinkedPullRequests(_itemId: string): Promise<PullRequest[]> {
    return []; // Handled by Storage, not remote
  }

  async getLinkedItems(_prId: string): Promise<string[]> {
    return []; // Handled by Storage, not remote
  }

  async linkItem(_prId: string, _itemId: string): Promise<void> {
    // Handled by Storage, not remote
  }

  async unlinkItem(_prId: string, _itemId: string): Promise<void> {
    // Handled by Storage, not remote
  }
  /* eslint-enable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */

  private async getIssueNodeId(issueNumber: number): Promise<string> {
    const data = await this.api.graphql<GetIssueNodeIdResponse>(
      GET_ISSUE_NODE_ID_QUERY,
      { owner: this.owner, repo: this.repo, number: issueNumber },
    );
    return data.repository.issue.id;
  }

  private async addSubIssue(
    parentNumber: string,
    childNumber: string,
  ): Promise<void> {
    const parentId = await this.getIssueNodeId(Number(parentNumber));
    const childId = await this.getIssueNodeId(Number(childNumber));
    await this.api.graphql(ADD_SUB_ISSUE_MUTATION, { parentId, childId });
  }

  private async removeSubIssue(
    parentNumber: string,
    childNumber: string,
  ): Promise<void> {
    const parentId = await this.getIssueNodeId(Number(parentNumber));
    const childId = await this.getIssueNodeId(Number(childNumber));
    await this.api.graphql(REMOVE_SUB_ISSUE_MUTATION, { parentId, childId });
  }

  private async fetchMilestones(): Promise<GhMilestone[]> {
    if (this.cachedMilestones) return this.cachedMilestones;
    const milestones: GhMilestone[] = [];
    for await (const page of this.api.paginate<GhMilestone>(
      `/repos/${this.owner}/${this.repo}/milestones`,
    )) {
      milestones.push(...page);
    }
    this.cachedMilestones = milestones;
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
}
