import type { Backend } from '../../backends/types.js';
import { runInit } from './init.js';

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

export function handleGetConfig(backend: Backend): ToolResult {
  return success({
    statuses: backend.getStatuses(),
    types: backend.getWorkItemTypes(),
    iterations: backend.getIterations(),
    currentIteration: backend.getCurrentIteration(),
  });
}
