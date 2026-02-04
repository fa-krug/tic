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
import { glab, glabExec } from './glab.js';
import { detectGroup } from './group.js';
import {
  mapIssueToWorkItem,
  mapEpicToWorkItem,
  mapNoteToComment,
} from './mappers.js';
import type { GlIssue, GlEpic, GlNote, GlIteration } from './mappers.js';

function parseId(id: string): { type: 'issue' | 'epic'; iid: string } {
  const match = id.match(/^(issue|epic)-(\d+)$/);
  if (!match) {
    throw new Error(
      `Invalid GitLab ID format: "${id}". Expected "issue-{iid}" or "epic-{iid}".`,
    );
  }
  return { type: match[1] as 'issue' | 'epic', iid: match[2]! };
}

export class GitLabBackend extends BaseBackend {
  private cwd: string;
  private group: string;
  private cachedIterations: GlIteration[] | null = null;

  constructor(cwd: string) {
    super(60_000);
    this.cwd = cwd;
    glabExec(['auth', 'status'], cwd);
    this.group = detectGroup(cwd);
  }

  protected override onCacheInvalidate(): void {
    this.cachedIterations = null;
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
      templates: true,
      templateFields: {
        type: false,
        status: false,
        priority: false,
        assignee: false,
        labels: false,
        iteration: false,
        parent: false,
        dependsOn: false,
        description: true,
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getStatuses(): Promise<string[]> {
    return ['open', 'closed'];
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getWorkItemTypes(): Promise<string[]> {
    return ['epic', 'issue'];
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getAssignees(): Promise<string[]> {
    try {
      const members = glab<{ username: string }[]>(
        ['api', 'projects/:fullpath/members/all', '--paginate'],
        this.cwd,
      );
      return members.map((m) => m.username);
    } catch {
      return [];
    }
  }

  async getLabels(): Promise<string[]> {
    return this.getLabelsFromCache();
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getIterations(): Promise<string[]> {
    const iterations = this.fetchIterations();
    return iterations.map((i) => i.title);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getCurrentIteration(): Promise<string> {
    const iterations = this.fetchIterations();
    const today = new Date().toISOString().split('T')[0]!;
    const current = iterations.find(
      (i) => i.start_date <= today && today <= i.due_date,
    );
    return current?.title ?? '';
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async setCurrentIteration(_name: string): Promise<void> {
    // No-op — current iteration is determined by date range
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async listWorkItems(iteration?: string): Promise<WorkItem[]> {
    // Fetch issues
    const issueArgs = [
      'issue',
      'list',
      '-F',
      'json',
      '--per-page',
      '100',
      '--all',
    ];
    const issues = glab<GlIssue[]>(issueArgs, this.cwd);
    let issueItems = issues.map(mapIssueToWorkItem);

    if (iteration) {
      issueItems = issueItems.filter((item) => item.iteration === iteration);
    }

    // Fetch epics
    const encodedGroup = encodeURIComponent(this.group);
    const epics = glab<GlEpic[]>(
      ['api', `groups/${encodedGroup}/epics`, '--paginate'],
      this.cwd,
    );
    const epicItems = epics.map(mapEpicToWorkItem);

    // Merge and sort by updated descending
    const allItems = [...epicItems, ...issueItems];
    allItems.sort((a, b) => b.updated.localeCompare(a.updated));
    return allItems;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getWorkItem(id: string): Promise<WorkItem> {
    const { type, iid } = parseId(id);

    if (type === 'issue') {
      const issue = glab<GlIssue>(
        ['issue', 'view', iid, '-F', 'json'],
        this.cwd,
      );
      const item = mapIssueToWorkItem(issue);

      // Fetch notes via API
      const notes = glab<GlNote[]>(
        ['api', `projects/:fullpath/issues/${iid}/notes`, '--paginate'],
        this.cwd,
      );
      item.comments = notes.map(mapNoteToComment);
      return item;
    }

    // Epic
    const encodedGroup = encodeURIComponent(this.group);
    const epic = glab<GlEpic>(
      ['api', `groups/${encodedGroup}/epics/${iid}`],
      this.cwd,
    );
    const item = mapEpicToWorkItem(epic);

    // Fetch epic notes
    const notes = glab<GlNote[]>(
      ['api', `groups/${encodedGroup}/epics/${iid}/notes`, '--paginate'],
      this.cwd,
    );
    item.comments = notes.map(mapNoteToComment);
    return item;
  }

  async createWorkItem(data: NewWorkItem): Promise<WorkItem> {
    this.validateFields(data);

    if (data.type === 'epic') {
      return this.createEpic(data);
    }
    return this.createIssue(data);
  }

  async updateWorkItem(id: string, data: Partial<WorkItem>): Promise<WorkItem> {
    this.validateFields(data);
    const { type, iid } = parseId(id);

    if (type === 'issue') {
      return this.updateIssue(iid, data);
    }
    return this.updateEpic(iid, data);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async deleteWorkItem(id: string): Promise<void> {
    const { type, iid } = parseId(id);

    if (type === 'issue') {
      glabExec(['issue', 'delete', iid, '--yes'], this.cwd);
      return;
    }

    const encodedGroup = encodeURIComponent(this.group);
    glab(
      ['api', `groups/${encodedGroup}/epics/${iid}`, '-X', 'DELETE'],
      this.cwd,
    );
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async addComment(workItemId: string, comment: NewComment): Promise<Comment> {
    const { type, iid } = parseId(workItemId);

    if (type === 'issue') {
      glabExec(['issue', 'note', iid, '-m', comment.body], this.cwd);
    } else {
      const encodedGroup = encodeURIComponent(this.group);
      glab(
        [
          'api',
          `groups/${encodedGroup}/epics/${iid}/notes`,
          '-X',
          'POST',
          '-f',
          `body=${comment.body}`,
        ],
        this.cwd,
      );
    }

    return {
      author: comment.author,
      date: new Date().toISOString(),
      body: comment.body,
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  override async getChildren(id: string): Promise<WorkItem[]> {
    const { type, iid } = parseId(id);

    if (type === 'issue') {
      return [];
    }

    const encodedGroup = encodeURIComponent(this.group);
    const issues = glab<GlIssue[]>(
      ['api', `groups/${encodedGroup}/epics/${iid}/issues`, '--paginate'],
      this.cwd,
    );
    return issues.map(mapIssueToWorkItem);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await
  override async getDependents(_id: string): Promise<WorkItem[]> {
    return [];
  }

  getItemUrl(id: string): string {
    const { type, iid } = parseId(id);

    if (type === 'issue') {
      const result = glab<{ web_url: string }>(
        ['issue', 'view', iid, '-F', 'json'],
        this.cwd,
      );
      return result.web_url;
    }

    return `https://gitlab.com/groups/${this.group}/-/epics/${iid}`;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async openItem(id: string): Promise<void> {
    const { type, iid } = parseId(id);

    if (type === 'issue') {
      glabExec(['issue', 'view', iid, '--web'], this.cwd);
      return;
    }

    const url = `https://gitlab.com/groups/${this.group}/-/epics/${iid}`;
    execFileSync('open', [url]);
  }

  /* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */
  async listTemplates(): Promise<Template[]> {
    throw new UnsupportedOperationError('templates', 'GitLabBackend');
  }
  async getTemplate(_slug: string): Promise<Template> {
    throw new UnsupportedOperationError('templates', 'GitLabBackend');
  }
  async createTemplate(_template: Template): Promise<Template> {
    throw new UnsupportedOperationError('templates', 'GitLabBackend');
  }
  async updateTemplate(
    _oldSlug: string,
    _template: Template,
  ): Promise<Template> {
    throw new UnsupportedOperationError('templates', 'GitLabBackend');
  }
  async deleteTemplate(_slug: string): Promise<void> {
    throw new UnsupportedOperationError('templates', 'GitLabBackend');
  }
  /* eslint-enable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */

  private fetchIterations(): GlIteration[] {
    if (this.cachedIterations) return this.cachedIterations;
    const encodedGroup = encodeURIComponent(this.group);
    this.cachedIterations = glab<GlIteration[]>(
      ['api', `groups/${encodedGroup}/iterations`, '--paginate'],
      this.cwd,
    );
    return this.cachedIterations;
  }

  private async createIssue(data: NewWorkItem): Promise<WorkItem> {
    const args = ['issue', 'create', '--title', data.title, '--yes'];

    if (data.description) {
      args.push('--description', data.description);
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

    const output = glabExec(args, this.cwd);
    // glab issue create prints a URL like: https://gitlab.com/group/project/-/issues/42
    const match = output.match(/\/issues\/(\d+)/);
    if (!match) {
      throw new Error('Failed to parse issue IID from glab output');
    }
    const iid = match[1]!;
    return this.getWorkItem(`issue-${iid}`);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  private async createEpic(data: NewWorkItem): Promise<WorkItem> {
    const encodedGroup = encodeURIComponent(this.group);
    const args = [
      'api',
      `groups/${encodedGroup}/epics`,
      '-X',
      'POST',
      '-f',
      `title=${data.title}`,
    ];

    if (data.description) {
      args.push('-f', `description=${data.description}`);
    }
    for (const label of data.labels) {
      args.push('-f', `labels[]=${label}`);
    }

    const epic = glab<GlEpic>(args, this.cwd);
    return mapEpicToWorkItem(epic);
  }

  private async updateIssue(
    iid: string,
    data: Partial<WorkItem>,
  ): Promise<WorkItem> {
    // Handle status changes via close/reopen
    if (data.status === 'closed') {
      glabExec(['issue', 'close', iid], this.cwd);
    } else if (data.status === 'open') {
      glabExec(['issue', 'reopen', iid], this.cwd);
    }

    // Handle field edits
    const editArgs = ['issue', 'update', iid];
    let hasEdits = false;

    if (data.title !== undefined) {
      editArgs.push('--title', data.title);
      hasEdits = true;
    }
    if (data.description !== undefined) {
      editArgs.push('--description', data.description);
      hasEdits = true;
    }
    if (data.iteration !== undefined) {
      if (data.iteration) {
        editArgs.push('--milestone', data.iteration);
      } else {
        editArgs.push('--unlabel', '');
      }
      hasEdits = true;
    }
    if (data.assignee !== undefined) {
      if (data.assignee) {
        editArgs.push('--assignee', data.assignee);
      }
      hasEdits = true;
    }
    if (data.labels !== undefined) {
      for (const label of data.labels) {
        editArgs.push('--label', label);
      }
      hasEdits = true;
    }

    if (hasEdits) {
      glabExec(editArgs, this.cwd);
    }

    return this.getWorkItem(`issue-${iid}`);
  }

  private async updateEpic(
    iid: string,
    data: Partial<WorkItem>,
  ): Promise<WorkItem> {
    const encodedGroup = encodeURIComponent(this.group);
    const args = ['api', `groups/${encodedGroup}/epics/${iid}`, '-X', 'PUT'];
    let hasEdits = false;

    if (data.title !== undefined) {
      args.push('-f', `title=${data.title}`);
      hasEdits = true;
    }
    if (data.description !== undefined) {
      args.push('-f', `description=${data.description}`);
      hasEdits = true;
    }
    if (data.status !== undefined) {
      const stateEvent = data.status === 'closed' ? 'close' : 'reopen';
      args.push('-f', `state_event=${stateEvent}`);
      hasEdits = true;
    }
    if (data.labels !== undefined) {
      args.push('-f', `labels=${data.labels.join(',')}`);
      hasEdits = true;
    }

    if (hasEdits) {
      glab(args, this.cwd);
    }

    return this.getWorkItem(`epic-${iid}`);
  }
}
