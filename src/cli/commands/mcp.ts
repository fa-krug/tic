import type { Backend } from '../../backends/types.js';
import { runInit } from './init.js';
import {
  runItemComment,
  runItemCreate,
  runItemDelete,
  runItemList,
  runItemShow,
  runItemUpdate,
} from './item.js';
import type { ItemCreateOptions, ItemUpdateOptions } from './item.js';
import { runIterationSet } from './iteration.js';

export interface ToolResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

export function success(data: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

export function error(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

export function handleInitProject(root: string): ToolResult {
  const result = runInit(root);
  return success(result);
}

export interface ListItemsArgs {
  status?: string;
  type?: string;
  iteration?: string;
  all?: boolean;
}

export function handleGetConfig(backend: Backend): ToolResult {
  return success({
    statuses: backend.getStatuses(),
    types: backend.getWorkItemTypes(),
    iterations: backend.getIterations(),
    currentIteration: backend.getCurrentIteration(),
  });
}

export function handleListItems(
  backend: Backend,
  args: ListItemsArgs,
): ToolResult {
  const items = runItemList(backend, {
    status: args.status,
    type: args.type,
    iteration: args.iteration,
    all: args.all,
  });
  return success(items);
}

export function handleShowItem(
  backend: Backend,
  args: { id: number },
): ToolResult {
  try {
    const item = runItemShow(backend, args.id);
    return success(item);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return error(message);
  }
}

export interface CreateItemArgs {
  title: string;
  type?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  labels?: string;
  iteration?: string;
  parent?: number;
  depends_on?: number[];
  description?: string;
}

export interface UpdateItemArgs {
  id: number;
  title?: string;
  type?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  labels?: string;
  iteration?: string;
  parent?: number;
  depends_on?: number[];
  description?: string;
}

export function handleCreateItem(
  backend: Backend,
  args: CreateItemArgs,
): ToolResult {
  try {
    const opts: ItemCreateOptions = {};
    if (args.type !== undefined) opts.type = args.type;
    if (args.status !== undefined) opts.status = args.status;
    if (args.priority !== undefined) opts.priority = args.priority;
    if (args.assignee !== undefined) opts.assignee = args.assignee;
    if (args.labels !== undefined) opts.labels = args.labels;
    if (args.iteration !== undefined) opts.iteration = args.iteration;
    if (args.parent !== undefined) opts.parent = String(args.parent);
    if (args.depends_on !== undefined)
      opts.dependsOn = args.depends_on.join(',');
    if (args.description !== undefined) opts.description = args.description;
    const item = runItemCreate(backend, args.title, opts);
    return success(item);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return error(message);
  }
}

export function handleUpdateItem(
  backend: Backend,
  args: UpdateItemArgs,
): ToolResult {
  try {
    const opts: ItemUpdateOptions = {};
    if (args.title !== undefined) opts.title = args.title;
    if (args.type !== undefined) opts.type = args.type;
    if (args.status !== undefined) opts.status = args.status;
    if (args.priority !== undefined) opts.priority = args.priority;
    if (args.assignee !== undefined) opts.assignee = args.assignee;
    if (args.labels !== undefined) opts.labels = args.labels;
    if (args.iteration !== undefined) opts.iteration = args.iteration;
    if (args.parent !== undefined) opts.parent = String(args.parent);
    if (args.depends_on !== undefined)
      opts.dependsOn = args.depends_on.join(',');
    if (args.description !== undefined) opts.description = args.description;
    const item = runItemUpdate(backend, args.id, opts);
    return success(item);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return error(message);
  }
}

export type DeleteTracker = Set<number>;

export function createDeleteTracker(): DeleteTracker {
  return new Set<number>();
}

export function handleDeleteItem(
  backend: Backend,
  args: { id: number },
  pendingDeletes: DeleteTracker,
): ToolResult {
  try {
    const item = backend.getWorkItem(args.id);
    const children = backend.getChildren(args.id);
    const dependents = backend.getDependents(args.id);
    pendingDeletes.add(args.id);
    return success({ item, children, dependents });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return error(message);
  }
}

export function handleConfirmDelete(
  backend: Backend,
  args: { id: number },
  pendingDeletes: DeleteTracker,
): ToolResult {
  if (!pendingDeletes.has(args.id)) {
    return error(
      `Item #${args.id} has not been previewed for deletion. Call delete_item first.`,
    );
  }
  try {
    runItemDelete(backend, args.id);
    pendingDeletes.delete(args.id);
    return success({ deleted: args.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return error(message);
  }
}

export function handleAddComment(
  backend: Backend,
  args: { id: number; text: string; author?: string },
): ToolResult {
  try {
    const comment = runItemComment(backend, args.id, args.text, {
      author: args.author,
    });
    return success(comment);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return error(message);
  }
}

export function handleSetIteration(
  backend: Backend,
  args: { name: string },
): ToolResult {
  try {
    runIterationSet(backend, args.name);
    return success({ currentIteration: args.name });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return error(message);
  }
}
