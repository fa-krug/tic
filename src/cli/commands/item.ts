import type { Backend } from '../../backends/types.js';
import type { WorkItem, Comment } from '../../types.js';

export interface ItemCreateOptions {
  type?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  labels?: string;
  iteration?: string;
  parent?: string;
  dependsOn?: string;
  description?: string;
}

export interface ItemListOptions {
  status?: string;
  type?: string;
  iteration?: string;
  all?: boolean;
}

export interface ItemUpdateOptions {
  title?: string;
  type?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  labels?: string;
  iteration?: string;
  parent?: string;
  dependsOn?: string;
  description?: string;
}

export interface ItemCommentOptions {
  author?: string;
}

const VALID_PRIORITIES = ['low', 'medium', 'high', 'critical'];

export async function runItemCreate(
  backend: Backend,
  title: string,
  opts: ItemCreateOptions,
): Promise<WorkItem> {
  const statuses = await backend.getStatuses();
  const types = await backend.getWorkItemTypes();

  if (opts.type !== undefined && !types.includes(opts.type)) {
    throw new Error(
      `Invalid type "${opts.type}". Valid types: ${types.join(', ')}`,
    );
  }
  if (opts.status !== undefined && !statuses.includes(opts.status)) {
    throw new Error(
      `Invalid status "${opts.status}". Valid statuses: ${statuses.join(', ')}`,
    );
  }
  if (
    opts.priority !== undefined &&
    !VALID_PRIORITIES.includes(opts.priority)
  ) {
    throw new Error(
      `Invalid priority "${opts.priority}". Valid priorities: ${VALID_PRIORITIES.join(', ')}`,
    );
  }

  // Resolve display ID strings to rowIds for relationships
  let parentRowId: number | null = null;
  if (opts.parent) {
    const parentItem = await backend.getWorkItem(opts.parent);
    parentRowId = parentItem.rowId;
  }
  const depDisplayIds = opts.dependsOn
    ? opts.dependsOn
        .split(',')
        .map((d) => d.trim())
        .filter((d) => d.length > 0)
    : [];
  const depRowIds: number[] = [];
  for (const depId of depDisplayIds) {
    const depItem = await backend.getWorkItem(depId);
    depRowIds.push(depItem.rowId);
  }

  return backend.cachedCreateWorkItem({
    title,
    type: opts.type ?? (types.includes('task') ? 'task' : (types[0] ?? 'task')),
    status: opts.status ?? statuses[0] ?? 'open',
    priority: (opts.priority as WorkItem['priority']) ?? 'medium',
    assignee: opts.assignee ?? '',
    labels: opts.labels ? opts.labels.split(',').map((l) => l.trim()) : [],
    iteration: opts.iteration ?? (await backend.getCurrentIteration()),
    parent: parentRowId,
    dependsOn: depRowIds,
    description: opts.description ?? '',
  });
}

export async function runItemList(
  backend: Backend,
  opts: ItemListOptions,
): Promise<WorkItem[]> {
  const iteration = opts.all
    ? undefined
    : (opts.iteration ?? (await backend.getCurrentIteration()));
  let items = await backend.listWorkItems(iteration);
  if (opts.status) {
    items = items.filter((i) => i.status === opts.status);
  }
  if (opts.type) {
    items = items.filter((i) => i.type === opts.type);
  }
  return items;
}

export async function runItemShow(
  backend: Backend,
  id: string,
): Promise<WorkItem> {
  return backend.getWorkItem(id);
}

export async function runItemUpdate(
  backend: Backend,
  id: string,
  opts: ItemUpdateOptions,
): Promise<WorkItem> {
  if (opts.type !== undefined) {
    const types = await backend.getWorkItemTypes();
    if (!types.includes(opts.type)) {
      throw new Error(
        `Invalid type "${opts.type}". Valid types: ${types.join(', ')}`,
      );
    }
  }
  if (opts.status !== undefined) {
    const statuses = await backend.getStatuses();
    if (!statuses.includes(opts.status)) {
      throw new Error(
        `Invalid status "${opts.status}". Valid statuses: ${statuses.join(', ')}`,
      );
    }
  }
  if (
    opts.priority !== undefined &&
    !VALID_PRIORITIES.includes(opts.priority)
  ) {
    throw new Error(
      `Invalid priority "${opts.priority}". Valid priorities: ${VALID_PRIORITIES.join(', ')}`,
    );
  }

  const data: Partial<WorkItem> = {};
  if (opts.title !== undefined) data.title = opts.title;
  if (opts.type !== undefined) data.type = opts.type;
  if (opts.status !== undefined) data.status = opts.status;
  if (opts.priority !== undefined)
    data.priority = opts.priority as WorkItem['priority'];
  if (opts.assignee !== undefined) data.assignee = opts.assignee;
  if (opts.labels !== undefined)
    data.labels = opts.labels.split(',').map((l) => l.trim());
  if (opts.iteration !== undefined) data.iteration = opts.iteration;
  if (opts.parent !== undefined) {
    if (opts.parent === '') {
      data.parent = null;
    } else {
      const parentItem = await backend.getWorkItem(opts.parent);
      data.parent = parentItem.rowId;
    }
  }
  if (opts.dependsOn !== undefined) {
    if (opts.dependsOn === '') {
      data.dependsOn = [];
    } else {
      const depDisplayIds = opts.dependsOn
        .split(',')
        .map((d) => d.trim())
        .filter((d) => d.length > 0);
      const depRowIds: number[] = [];
      for (const depId of depDisplayIds) {
        const depItem = await backend.getWorkItem(depId);
        depRowIds.push(depItem.rowId);
      }
      data.dependsOn = depRowIds;
    }
  }
  if (opts.description !== undefined) data.description = opts.description;
  return backend.cachedUpdateWorkItem(id, data);
}

export async function runItemDelete(
  backend: Backend,
  id: string,
): Promise<void> {
  await backend.cachedDeleteWorkItem(id);
}

export async function runItemOpen(backend: Backend, id: string): Promise<void> {
  await backend.openItem(id);
}

export async function runItemComment(
  backend: Backend,
  id: string,
  text: string,
  opts: ItemCommentOptions,
): Promise<Comment> {
  return backend.addComment(id, {
    author: opts.author ?? 'anonymous',
    body: text,
  });
}
