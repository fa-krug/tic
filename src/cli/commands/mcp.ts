import type { Backend } from '../../backends/types.js';
import { runInit } from './init.js';
import { runItemList, runItemShow } from './item.js';

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
