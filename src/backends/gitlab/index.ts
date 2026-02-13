import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { BaseBackend } from '../types.js';
import type { BackendCapabilities } from '../types.js';
import type {
  WorkItem,
  NewWorkItem,
  NewComment,
  Comment,
  Template,
} from '../../types.js';
import { GitLabApiClient } from './api.js';
import type { Connection } from './api.js';
import type { GitLabRemoteInfo } from './remote.js';
import { parseGitLabRemote } from './remote.js';
import { mapWorkItemToWorkItem, mapNoteToComment } from './mappers.js';
import type { GlWorkItem } from './mappers.js';
import { AuthError } from '../shared/api-client.js';
import {
  getGitLabToken,
  getGitLabPat,
  authenticateGitLab,
} from '../../auth/gitlab.js';
import { slugifyTemplateName } from '../local/templates.js';

const WORK_ITEM_FIELDS = `
  id iid title state createdAt updatedAt
  workItemType { name }
  widgets {
    ... on WorkItemWidgetDescription { description }
    ... on WorkItemWidgetAssignees { assignees { nodes { username } } }
    ... on WorkItemWidgetLabels { labels { nodes { title } } }
    ... on WorkItemWidgetMilestone { milestone { title } }
    ... on WorkItemWidgetHierarchy {
      parent { id iid workItemType { name } }
    }
    __typename
  }
`;

const WORK_ITEM_DETAIL_FIELDS = `
  id iid title state createdAt updatedAt
  workItemType { name }
  widgets {
    ... on WorkItemWidgetDescription { description }
    ... on WorkItemWidgetAssignees { assignees { nodes { username } } }
    ... on WorkItemWidgetLabels { labels { nodes { title } } }
    ... on WorkItemWidgetMilestone { milestone { title } }
    ... on WorkItemWidgetHierarchy {
      parent { id iid workItemType { name } }
      children { nodes { id iid title state workItemType { name } } }
    }
    ... on WorkItemWidgetNotes {
      discussions {
        nodes { notes { nodes { author { username } createdAt body } } }
      }
    }
    __typename
  }
`;

const LIST_PROJECT_ISSUES = `query($fullPath: ID!, $cursor: String) {
  project(fullPath: $fullPath) {
    workItems(types: [ISSUE, TASK], first: 100, after: $cursor) {
      nodes { ${WORK_ITEM_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

const LIST_GROUP_EPICS = `query($fullPath: ID!, $cursor: String) {
  group(fullPath: $fullPath) {
    workItems(types: [EPIC], first: 100, after: $cursor) {
      nodes { ${WORK_ITEM_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

const GET_WORK_ITEM = `query($id: WorkItemID!) {
  workItem(id: $id) { ${WORK_ITEM_DETAIL_FIELDS} }
}`;

const LOOKUP_PROJECT_ITEM = `query($fullPath: ID!, $iid: String!) {
  project(fullPath: $fullPath) {
    workItems(iid: $iid, first: 1) {
      nodes { id iid workItemType { name } }
    }
  }
}`;

const LOOKUP_GROUP_ITEM = `query($fullPath: ID!, $iid: String!) {
  group(fullPath: $fullPath) {
    workItems(iid: $iid, types: [EPIC], first: 1) {
      nodes { id iid workItemType { name } }
    }
  }
}`;

const CREATE_WORK_ITEM = `mutation($input: WorkItemCreateInput!) {
  workItemCreate(input: $input) {
    workItem { ${WORK_ITEM_FIELDS} }
    errors
  }
}`;

const UPDATE_WORK_ITEM = `mutation($input: WorkItemUpdateInput!) {
  workItemUpdate(input: $input) {
    workItem { ${WORK_ITEM_FIELDS} }
    errors
  }
}`;

const DELETE_WORK_ITEM = `mutation($input: WorkItemDeleteInput!) {
  workItemDelete(input: $input) { errors }
}`;

const CREATE_NOTE = `mutation($input: CreateNoteInput!) {
  createNote(input: $input) {
    note { id body author { username } createdAt }
    errors
  }
}`;

const WORK_ITEM_TYPES = `query($projectPath: ID!) {
  project(fullPath: $projectPath) {
    workItemTypes { nodes { id name } }
  }
}`;

const PROJECT_MEMBERS = `query($fullPath: ID!, $cursor: String) {
  project(fullPath: $fullPath) {
    projectMembers(first: 100, after: $cursor) {
      nodes { user { username } }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

const PROJECT_MILESTONES = `query($fullPath: ID!, $cursor: String) {
  project(fullPath: $fullPath) {
    milestones(first: 100, after: $cursor) {
      nodes { title startDate dueDate }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

interface ListProjectIssuesRes {
  project: { workItems: Connection<GlWorkItem> };
}
interface ListGroupEpicsRes {
  group: { workItems: Connection<GlWorkItem> };
}
interface GetWorkItemRes {
  workItem: GlWorkItem;
}
interface LookupProjectRes {
  project: {
    workItems: {
      nodes: Array<{
        id: string;
        iid: string;
        workItemType: { name: string };
      }>;
    };
  };
}
interface LookupGroupRes {
  group: {
    workItems: {
      nodes: Array<{
        id: string;
        iid: string;
        workItemType: { name: string };
      }>;
    };
  };
}
interface CreateRes {
  workItemCreate: { workItem: GlWorkItem; errors: string[] };
}
interface UpdateRes {
  workItemUpdate: { workItem: GlWorkItem; errors: string[] };
}
interface DeleteRes {
  workItemDelete: { errors: string[] };
}
interface NoteRes {
  createNote: {
    note: {
      id: string;
      body: string;
      author: { username: string };
      createdAt: string;
    };
    errors: string[];
  };
}
interface TypesRes {
  project: {
    workItemTypes: { nodes: Array<{ id: string; name: string }> };
  };
}
interface MembersRes {
  project: {
    projectMembers: Connection<{ user: { username: string } }>;
  };
}
interface MilestoneNode {
  title: string;
  startDate: string;
  dueDate: string;
}
interface MilestonesRes {
  project: { milestones: Connection<MilestoneNode> };
}

const TEMPLATES_DIR = '.gitlab/issue_templates';

function parseId(id: string): { type: 'issue' | 'epic'; iid: string } {
  const match = id.match(/^(issue|epic)-(\d+)$/);
  if (!match) {
    throw new Error(
      `Invalid GitLab ID format: "${id}". Expected "issue-{iid}" or "epic-{iid}".`,
    );
  }
  return { type: match[1] as 'issue' | 'epic', iid: match[2]! };
}

async function queryWorkItemTypes(
  api: GitLabApiClient,
  projectPath: string,
): Promise<Map<string, string>> {
  const data = await api.graphql<TypesRes>(WORK_ITEM_TYPES, {
    projectPath,
  });
  const m = new Map<string, string>();
  for (const t of data.project.workItemTypes.nodes) {
    m.set(t.name.toLowerCase(), t.id);
  }
  return m;
}

export interface GitLabBackendOptions {
  skipAuth?: boolean;
}

export class GitLabBackend extends BaseBackend {
  private api: GitLabApiClient;
  private remote: GitLabRemoteInfo;
  private typeIds: Map<string, string>;
  private gidCache = new Map<string, string>();
  private cwd: string;
  private cachedMilestones: MilestoneNode[] | null = null;

  private constructor(
    api: GitLabApiClient,
    remote: GitLabRemoteInfo,
    typeIds: Map<string, string>,
    cwd: string,
  ) {
    super(60_000);
    this.api = api;
    this.remote = remote;
    this.typeIds = typeIds;
    this.cwd = cwd;
  }

  static async create(
    cwd: string,
    options?: GitLabBackendOptions,
  ): Promise<GitLabBackend> {
    const remote = parseGitLabRemote(cwd);
    let token = getGitLabToken();
    if (!token) token = getGitLabPat();
    if (!token) {
      if (options?.skipAuth) {
        throw new AuthError(
          'GitLab authentication required. Run "tic auth login gitlab" to authenticate.',
        );
      }
      token = await authenticateGitLab({
        onCode: (code, url) => {
          console.log(`\nGitLab authentication required.`);
          console.log(`Visit ${url} and enter code: ${code}\n`);
        },
      });
    }
    const api = new GitLabApiClient(token);
    const typeIds = await queryWorkItemTypes(api, remote.fullPath);
    return new GitLabBackend(api, remote, typeIds, cwd);
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
      requiredFields: ['title'],
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

  async getAssignees(): Promise<string[]> {
    try {
      const members: string[] = [];
      for await (const page of this.api.paginate<{
        user: { username: string };
      }>(
        PROJECT_MEMBERS,
        { fullPath: this.remote.fullPath },
        (data: unknown) => (data as MembersRes).project.projectMembers,
      )) {
        for (const m of page) {
          members.push(m.user.username);
        }
      }
      return members;
    } catch {
      return [];
    }
  }

  async getLabels(): Promise<string[]> {
    return this.getLabelsFromCache();
  }

  async getIterations(): Promise<string[]> {
    const ms = await this.fetchMilestones();
    return ms.map((m) => m.title);
  }

  async getCurrentIteration(): Promise<string> {
    const ms = await this.fetchMilestones();
    const today = new Date().toISOString().split('T')[0]!;
    const cur = ms.find((m) => m.startDate <= today && today <= m.dueDate);
    return cur?.title ?? '';
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async setCurrentIteration(_name: string): Promise<void> {
    // No-op — determined by date range
  }

  async listWorkItems(iteration?: string): Promise<WorkItem[]> {
    const issues: GlWorkItem[] = [];
    for await (const page of this.api.paginate<GlWorkItem>(
      LIST_PROJECT_ISSUES,
      { fullPath: this.remote.fullPath },
      (d: unknown) => (d as ListProjectIssuesRes).project.workItems,
    )) {
      issues.push(...page);
    }

    const epics: GlWorkItem[] = [];
    for await (const page of this.api.paginate<GlWorkItem>(
      LIST_GROUP_EPICS,
      { fullPath: this.remote.group },
      (d: unknown) => (d as ListGroupEpicsRes).group.workItems,
    )) {
      epics.push(...page);
    }

    const all = [...issues, ...epics];
    const items: WorkItem[] = [];
    for (const gl of all) {
      const item = mapWorkItemToWorkItem(gl);
      this.cacheGid(item.id, gl.id);
      items.push(item);
    }

    let filtered = items;
    if (iteration) {
      filtered = items.filter((i) => i.iteration === iteration);
    }
    filtered.sort((a, b) => b.updated.localeCompare(a.updated));
    return filtered;
  }

  async getWorkItem(id: string): Promise<WorkItem> {
    const gid = await this.resolveGid(id);
    const data = await this.api.graphql<GetWorkItemRes>(GET_WORK_ITEM, {
      id: gid,
    });
    const item = mapWorkItemToWorkItem(data.workItem);
    this.cacheGid(item.id, data.workItem.id);
    return item;
  }

  async createWorkItem(data: NewWorkItem): Promise<WorkItem> {
    this.validateFields(data);

    const isEpic = data.type === 'epic';
    const typeName = isEpic ? 'epic' : 'issue';
    const typeId = this.typeIds.get(typeName);
    if (!typeId) {
      throw new Error(`Work item type "${typeName}" not found in project`);
    }

    const input: Record<string, unknown> = {
      title: data.title,
      workItemTypeId: typeId,
      namespacePath: isEpic ? this.remote.group : this.remote.fullPath,
    };
    if (data.description) {
      input['descriptionWidget'] = { description: data.description };
    }

    const res = await this.api.graphql<CreateRes>(CREATE_WORK_ITEM, {
      input,
    });
    if (res.workItemCreate.errors.length > 0) {
      throw new Error(
        `Failed to create work item: ${res.workItemCreate.errors.join(', ')}`,
      );
    }

    const created = res.workItemCreate.workItem;
    const item = mapWorkItemToWorkItem(created);
    this.cacheGid(item.id, created.id);

    const needsUpdate =
      data.assignee ||
      data.labels.length > 0 ||
      data.iteration ||
      data.status === 'closed';

    if (needsUpdate) {
      const partial: Partial<WorkItem> = {};
      if (data.assignee) partial.assignee = data.assignee;
      if (data.labels.length > 0) partial.labels = data.labels;
      if (data.iteration) partial.iteration = data.iteration;
      if (data.status === 'closed') partial.status = 'closed';
      const updates = this.buildWidgetUpdates(partial);
      return this.applyUpdate(
        created.id,
        updates,
        data.status === 'closed' ? 'closed' : undefined,
      );
    }

    return item;
  }

  async updateWorkItem(id: string, data: Partial<WorkItem>): Promise<WorkItem> {
    this.validateFields(data);
    const gid = await this.resolveGid(id);
    const updates = this.buildWidgetUpdates(data);
    const hasChanges =
      updates.length > 0 ||
      data.title !== undefined ||
      data.status !== undefined;

    if (hasChanges) {
      return this.applyUpdate(gid, updates, data.status, data.title);
    }
    return this.getWorkItem(id);
  }

  async deleteWorkItem(id: string): Promise<void> {
    const gid = await this.resolveGid(id);
    const res = await this.api.graphql<DeleteRes>(DELETE_WORK_ITEM, {
      input: { id: gid },
    });
    if (res.workItemDelete.errors.length > 0) {
      throw new Error(
        `Failed to delete work item: ${res.workItemDelete.errors.join(', ')}`,
      );
    }
    this.gidCache.delete(id);
  }

  async addComment(workItemId: string, comment: NewComment): Promise<Comment> {
    const gid = await this.resolveGid(workItemId);
    const res = await this.api.graphql<NoteRes>(CREATE_NOTE, {
      input: { noteableId: gid, body: comment.body },
    });
    if (res.createNote.errors.length > 0) {
      throw new Error(
        `Failed to add comment: ${res.createNote.errors.join(', ')}`,
      );
    }
    return mapNoteToComment(res.createNote.note);
  }

  override async getChildren(id: string): Promise<WorkItem[]> {
    const { type } = parseId(id);
    if (type === 'issue') return [];

    const gid = await this.resolveGid(id);
    const data = await this.api.graphql<GetWorkItemRes>(GET_WORK_ITEM, {
      id: gid,
    });

    for (const w of data.workItem.widgets) {
      if (
        w.__typename === 'WorkItemWidgetHierarchy' &&
        'children' in w &&
        w.children
      ) {
        const children = (
          w.children as {
            nodes: Array<{
              id: string;
              iid: string;
              title: string;
              state: string;
              workItemType: { name: string };
            }>;
          }
        ).nodes;
        return children.map((c) => {
          const ct = c.workItemType.name.toLowerCase();
          const cid = `${ct}-${c.iid}`;
          this.cacheGid(cid, c.id);
          return {
            id: cid,
            title: c.title,
            description: '',
            status: c.state === 'CLOSED' ? 'closed' : 'open',
            type: ct,
            assignee: '',
            labels: [],
            iteration: '',
            priority: 'medium' as const,
            created: '',
            updated: '',
            parent: id,
            dependsOn: [],
            comments: [],
          };
        });
      }
    }
    return [];
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await
  override async getDependents(_id: string): Promise<WorkItem[]> {
    return [];
  }

  getItemUrl(id: string): string {
    const { type, iid } = parseId(id);
    if (type === 'issue') {
      return `https://${this.remote.host}/${this.remote.fullPath}/-/issues/${iid}`;
    }
    return `https://${this.remote.host}/groups/${this.remote.group}/-/epics/${iid}`;
  }

  async openItem(id: string): Promise<void> {
    const url = this.getItemUrl(id);
    const { default: open } = await import('open');
    await open(url);
  }

  async listTemplates(): Promise<Template[]> {
    const dir = path.join(this.cwd, TEMPLATES_DIR);
    try {
      const files = await fs.readdir(dir);
      return Promise.all(
        files
          .filter((f) => f.endsWith('.md'))
          .map(async (f) => {
            const name = f.replace(/\.md$/, '');
            const slug = slugifyTemplateName(name);
            const content = await fs.readFile(path.join(dir, f), 'utf-8');
            return { slug, name, description: content };
          }),
      );
    } catch {
      return [];
    }
  }

  async getTemplate(slug: string): Promise<Template> {
    const templates = await this.listTemplates();
    const found = templates.find((tmpl) => tmpl.slug === slug);
    if (!found) throw new Error(`Template not found: ${slug}`);
    return found;
  }

  async createTemplate(template: Template): Promise<Template> {
    const dir = path.join(this.cwd, TEMPLATES_DIR);
    await fs.mkdir(dir, { recursive: true });
    const slug = slugifyTemplateName(template.name);
    const fp = path.join(dir, `${template.name}.md`);
    const content = template.description ?? '';
    await fs.writeFile(fp, content, 'utf-8');
    return { slug, name: template.name, description: content };
  }

  async updateTemplate(oldSlug: string, template: Template): Promise<Template> {
    const newSlug = slugifyTemplateName(template.name);
    const content = template.description ?? '';

    if (oldSlug !== newSlug) {
      const old = await this.getTemplate(oldSlug);
      const oldPath = path.join(this.cwd, TEMPLATES_DIR, `${old.name}.md`);
      try {
        await fs.unlink(oldPath);
      } catch {
        // Old file may not exist
      }
    }

    const dir = path.join(this.cwd, TEMPLATES_DIR);
    await fs.mkdir(dir, { recursive: true });
    const fp = path.join(dir, `${template.name}.md`);
    await fs.writeFile(fp, content, 'utf-8');
    return { slug: newSlug, name: template.name, description: content };
  }

  async deleteTemplate(slug: string): Promise<void> {
    const found = await this.getTemplate(slug);
    const fp = path.join(this.cwd, TEMPLATES_DIR, `${found.name}.md`);
    await fs.unlink(fp);
  }

  private cacheGid(localId: string, gid: string): void {
    this.gidCache.set(localId, gid);
  }

  private async resolveGid(id: string): Promise<string> {
    const cached = this.gidCache.get(id);
    if (cached) return cached;

    const { type, iid } = parseId(id);
    if (type === 'issue') {
      const data = await this.api.graphql<LookupProjectRes>(
        LOOKUP_PROJECT_ITEM,
        { fullPath: this.remote.fullPath, iid },
      );
      const node = data.project.workItems.nodes[0];
      if (!node) throw new Error(`Work item not found: ${id}`);
      this.cacheGid(id, node.id);
      return node.id;
    }

    const data = await this.api.graphql<LookupGroupRes>(LOOKUP_GROUP_ITEM, {
      fullPath: this.remote.group,
      iid,
    });
    const node = data.group.workItems.nodes[0];
    if (!node) throw new Error(`Work item not found: ${id}`);
    this.cacheGid(id, node.id);
    return node.id;
  }

  private buildWidgetUpdates(
    data: Partial<WorkItem>,
  ): Array<Record<string, unknown>> {
    const updates: Array<Record<string, unknown>> = [];

    if (data.description !== undefined) {
      updates.push({
        descriptionWidget: { description: data.description },
      });
    }
    if (data.assignee !== undefined) {
      if (data.assignee) {
        updates.push({
          assigneesWidget: {
            assigneeIds: [],
            usernames: [data.assignee],
          },
        });
      } else {
        updates.push({ assigneesWidget: { assigneeIds: [] } });
      }
    }
    if (data.labels !== undefined) {
      updates.push({
        labelsWidget: { setLabelTitles: data.labels },
      });
    }
    if (data.iteration !== undefined) {
      if (data.iteration) {
        updates.push({
          milestoneWidget: { milestoneTitle: data.iteration },
        });
      } else {
        updates.push({ milestoneWidget: { milestoneId: null } });
      }
    }
    if (data.parent !== undefined) {
      if (data.parent) {
        updates.push({ hierarchyWidget: { parentId: data.parent } });
      } else {
        updates.push({ hierarchyWidget: { parentId: null } });
      }
    }

    return updates;
  }

  private async applyUpdate(
    gid: string,
    widgetUpdates: Array<Record<string, unknown>>,
    status?: string,
    title?: string,
  ): Promise<WorkItem> {
    const input: Record<string, unknown> = { id: gid };

    if (title !== undefined) input['title'] = title;
    if (status !== undefined) {
      input['stateEvent'] = status === 'closed' ? 'CLOSE' : 'REOPEN';
    }

    for (const update of widgetUpdates) {
      for (const [key, value] of Object.entries(update)) {
        if (key === 'hierarchyWidget' && value && typeof value === 'object') {
          const hv = value as { parentId: string | null };
          if (
            hv.parentId &&
            typeof hv.parentId === 'string' &&
            !hv.parentId.startsWith('gid://')
          ) {
            const parentGid = await this.resolveGid(hv.parentId);
            input[key] = { parentId: parentGid };
          } else {
            input[key] = value;
          }
        } else {
          input[key] = value;
        }
      }
    }

    const res = await this.api.graphql<UpdateRes>(UPDATE_WORK_ITEM, {
      input,
    });
    if (res.workItemUpdate.errors.length > 0) {
      throw new Error(
        `Failed to update work item: ${res.workItemUpdate.errors.join(', ')}`,
      );
    }

    const updated = res.workItemUpdate.workItem;
    const item = mapWorkItemToWorkItem(updated);
    this.cacheGid(item.id, updated.id);
    return item;
  }

  private async fetchMilestones(): Promise<MilestoneNode[]> {
    if (this.cachedMilestones) return this.cachedMilestones;
    const ms: MilestoneNode[] = [];
    for await (const page of this.api.paginate<MilestoneNode>(
      PROJECT_MILESTONES,
      { fullPath: this.remote.fullPath },
      (d: unknown) => (d as MilestonesRes).project.milestones,
    )) {
      ms.push(...page);
    }
    this.cachedMilestones = ms;
    return ms;
  }
}
