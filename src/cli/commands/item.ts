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

export function runItemCreate(
  backend: Backend,
  title: string,
  opts: ItemCreateOptions,
): WorkItem {
  const statuses = backend.getStatuses();
  const types = backend.getWorkItemTypes();
  return backend.createWorkItem({
    title,
    type: opts.type ?? (types.includes('task') ? 'task' : types[0]!),
    status: opts.status ?? statuses[0]!,
    priority: (opts.priority as WorkItem['priority']) ?? 'medium',
    assignee: opts.assignee ?? '',
    labels: opts.labels ? opts.labels.split(',').map((l) => l.trim()) : [],
    iteration: opts.iteration ?? backend.getCurrentIteration(),
    parent: opts.parent ? Number(opts.parent) : null,
    dependsOn: opts.dependsOn
      ? opts.dependsOn.split(',').map((d) => Number(d.trim()))
      : [],
    description: opts.description ?? '',
  });
}

export function runItemList(
  backend: Backend,
  opts: ItemListOptions,
): WorkItem[] {
  const iteration = opts.all
    ? undefined
    : (opts.iteration ?? backend.getCurrentIteration());
  let items = backend.listWorkItems(iteration);
  if (opts.status) {
    items = items.filter((i) => i.status === opts.status);
  }
  if (opts.type) {
    items = items.filter((i) => i.type === opts.type);
  }
  return items;
}

export function runItemShow(backend: Backend, id: number): WorkItem {
  return backend.getWorkItem(id);
}

export function runItemUpdate(
  backend: Backend,
  id: number,
  opts: ItemUpdateOptions,
): WorkItem {
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
  if (opts.parent !== undefined)
    data.parent = opts.parent === '' ? null : Number(opts.parent);
  if (opts.dependsOn !== undefined)
    data.dependsOn =
      opts.dependsOn === ''
        ? []
        : opts.dependsOn.split(',').map((d) => Number(d.trim()));
  if (opts.description !== undefined) data.description = opts.description;
  return backend.updateWorkItem(id, data);
}

export function runItemDelete(backend: Backend, id: number): void {
  backend.deleteWorkItem(id);
}

export function runItemComment(
  backend: Backend,
  id: number,
  text: string,
  opts: ItemCommentOptions,
): Comment {
  return backend.addComment(id, {
    author: opts.author ?? 'anonymous',
    body: text,
  });
}
