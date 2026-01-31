import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  createBackend as createBackendFromConfig,
  VALID_BACKENDS,
} from '../../backends/factory.js';
import { readConfig, writeConfig } from '../../backends/local/config.js';
import type { Backend } from '../../backends/types.js';
import fs from 'node:fs';
import path from 'node:path';
import { runInit } from './init.js';
import {
  runItemComment,
  runItemCreate,
  runItemDelete,
  runItemList,
  runItemShow,
  runItemUpdate,
} from './item.js';
import type {
  ItemCreateOptions,
  ItemListOptions,
  ItemUpdateOptions,
} from './item.js';
import { runIterationSet } from './iteration.js';

export interface ToolResult {
  [key: string]: unknown;
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

function success(data: unknown): ToolResult {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

function error(message: string): ToolResult {
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true,
  };
}

export function handleInitProject(root: string): ToolResult {
  try {
    const result = runInit(root);
    if (result.alreadyExists) {
      return success({ alreadyExists: true });
    }
    return success({ initialized: true });
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}

export interface ListItemsArgs {
  status?: string;
  type?: string;
  iteration?: string;
  all?: boolean;
}

export function handleGetConfig(backend: Backend, root: string): ToolResult {
  try {
    const config = readConfig(root);
    return success({
      backend: config.backend,
      statuses: backend.getStatuses(),
      types: backend.getWorkItemTypes(),
      iterations: backend.getIterations(),
      currentIteration: backend.getCurrentIteration(),
      capabilities: backend.getCapabilities(),
    });
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}

export function handleSetBackend(
  root: string,
  args: { backend: string },
): ToolResult {
  try {
    if (!(VALID_BACKENDS as readonly string[]).includes(args.backend)) {
      return error(
        `Invalid backend "${args.backend}". Valid backends: ${VALID_BACKENDS.join(', ')}`,
      );
    }
    const config = readConfig(root);
    config.backend = args.backend;
    writeConfig(root, config);
    return success({ backend: args.backend });
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}

export function handleListItems(
  backend: Backend,
  args: ListItemsArgs,
): ToolResult {
  try {
    const items = runItemList(backend, {
      status: args.status,
      type: args.type,
      iteration: args.iteration,
      all: args.all,
    });
    return success(items);
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}

export function handleShowItem(
  backend: Backend,
  args: { id: string },
): ToolResult {
  try {
    const item = runItemShow(backend, args.id);
    const url = backend.getItemUrl(args.id);
    return success({ ...item, url });
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
  parent?: string;
  depends_on?: string[];
  description?: string;
}

export interface UpdateItemArgs {
  id: string;
  title?: string;
  type?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  labels?: string;
  iteration?: string;
  parent?: string | null;
  depends_on?: string[];
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
    if (args.parent !== undefined) opts.parent = args.parent;
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
    if (args.parent !== undefined)
      opts.parent = args.parent === null ? '' : args.parent;
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

export type DeleteTracker = Set<string>;

export function createDeleteTracker(): DeleteTracker {
  return new Set<string>();
}

export function handleDeleteItem(
  backend: Backend,
  args: { id: string },
  pendingDeletes: DeleteTracker,
): ToolResult {
  try {
    const item = backend.getWorkItem(args.id);
    const caps = backend.getCapabilities();
    const children = caps.relationships ? backend.getChildren(args.id) : [];
    const dependents = caps.relationships ? backend.getDependents(args.id) : [];
    pendingDeletes.add(args.id);
    return success({
      preview: true,
      item: {
        id: item.id,
        title: item.title,
        type: item.type,
        status: item.status,
      },
      affectedChildren: children.map((c) => ({ id: c.id, title: c.title })),
      affectedDependents: dependents.map((d) => ({
        id: d.id,
        title: d.title,
      })),
      message: 'Use confirm_delete to proceed with deletion.',
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return error(message);
  }
}

export function handleConfirmDelete(
  backend: Backend,
  args: { id: string },
  pendingDeletes: DeleteTracker,
): ToolResult {
  if (!pendingDeletes.has(args.id)) {
    return error(
      `No pending delete for item ${args.id}. Call delete_item first to preview.`,
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
  args: { id: string; text: string; author?: string },
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

export interface SearchItemsArgs {
  query: string;
  status?: string;
  type?: string;
  iteration?: string;
  all?: boolean;
}

export function handleSearchItems(
  backend: Backend,
  args: SearchItemsArgs,
): ToolResult {
  try {
    const items = runItemList(backend, {
      status: args.status,
      type: args.type,
      iteration: args.iteration,
      all: args.all,
    });
    const query = args.query.toLowerCase();
    const filtered = items.filter(
      (item) =>
        item.title.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query),
    );
    return success(filtered);
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}

export function handleGetChildren(
  backend: Backend,
  args: { id: string },
): ToolResult {
  try {
    const children = backend.getChildren(args.id);
    return success(children);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return error(message);
  }
}

export function handleGetDependents(
  backend: Backend,
  args: { id: string },
): ToolResult {
  try {
    const dependents = backend.getDependents(args.id);
    return success(dependents);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return error(message);
  }
}

interface TreeNode {
  id: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  iteration: string;
  children: TreeNode[];
}

export function handleGetItemTree(
  backend: Backend,
  args: ListItemsArgs,
): ToolResult {
  try {
    const opts: ItemListOptions = {};
    if (args.type) opts.type = args.type;
    if (args.status) opts.status = args.status;
    if (args.iteration) opts.iteration = args.iteration;
    if (args.all) opts.all = args.all;
    const items = runItemList(backend, opts);

    const nodeMap = new Map<string, TreeNode>();
    for (const item of items) {
      nodeMap.set(item.id, {
        id: item.id,
        title: item.title,
        type: item.type,
        status: item.status,
        priority: item.priority,
        iteration: item.iteration,
        children: [],
      });
    }

    const roots: TreeNode[] = [];
    for (const item of items) {
      const node = nodeMap.get(item.id)!;
      if (item.parent !== null && nodeMap.has(item.parent)) {
        nodeMap.get(item.parent)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return success(roots);
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}

export function registerTools(
  server: McpServer,
  backend: Backend,
  pendingDeletes: DeleteTracker,
  root: string,
): void {
  const caps = backend.getCapabilities();

  server.tool('init_project', 'Initialize a new tic project', () => {
    return handleInitProject(root);
  });

  server.tool('get_config', 'Get project configuration', () => {
    return handleGetConfig(backend, root);
  });

  server.tool(
    'list_items',
    'List work items with optional filters',
    {
      type: z.string().optional().describe('Filter by work item type'),
      status: z.string().optional().describe('Filter by status'),
      iteration: z.string().optional().describe('Filter by iteration'),
      all: z.boolean().optional().describe('Show all iterations'),
    },
    (args) => {
      return handleListItems(backend, args);
    },
  );

  server.tool(
    'show_item',
    'Show work item details',
    {
      id: z.string().describe('Work item ID'),
    },
    (args) => {
      return handleShowItem(backend, args);
    },
  );

  server.tool(
    'create_item',
    'Create a new work item',
    {
      title: z.string().describe('Work item title'),
      type: z.string().optional().describe('Work item type'),
      status: z.string().optional().describe('Initial status'),
      priority: z.string().optional().describe('Priority level'),
      assignee: z.string().optional().describe('Assignee'),
      labels: z.string().optional().describe('Comma-separated labels'),
      iteration: z.string().optional().describe('Iteration'),
      parent: z.string().optional().describe('Parent item ID'),
      depends_on: z
        .array(z.string())
        .optional()
        .describe('Dependency item IDs'),
      description: z.string().optional().describe('Work item description'),
    },
    (args) => {
      return handleCreateItem(backend, args);
    },
  );

  server.tool(
    'update_item',
    'Update an existing work item',
    {
      id: z.string().describe('Work item ID'),
      title: z.string().optional().describe('New title'),
      type: z.string().optional().describe('Work item type'),
      status: z.string().optional().describe('Status'),
      priority: z.string().optional().describe('Priority level'),
      assignee: z.string().optional().describe('Assignee'),
      labels: z.string().optional().describe('Comma-separated labels'),
      iteration: z.string().optional().describe('Iteration'),
      parent: z
        .string()
        .nullable()
        .optional()
        .describe('Parent item ID (null to clear)'),
      depends_on: z
        .array(z.string())
        .optional()
        .describe('Dependency item IDs'),
      description: z.string().optional().describe('Work item description'),
    },
    (args) => {
      return handleUpdateItem(backend, args);
    },
  );

  server.tool(
    'delete_item',
    'Preview deleting a work item (requires confirm_delete to finalize)',
    {
      id: z.string().describe('Work item ID'),
    },
    (args) => {
      return handleDeleteItem(backend, args, pendingDeletes);
    },
  );

  server.tool(
    'confirm_delete',
    'Confirm and execute a pending item deletion',
    {
      id: z.string().describe('Work item ID'),
    },
    (args) => {
      return handleConfirmDelete(backend, args, pendingDeletes);
    },
  );

  server.tool(
    'search_items',
    'Search work items by text query',
    {
      query: z.string().describe('Search query'),
      type: z.string().optional().describe('Filter by work item type'),
      status: z.string().optional().describe('Filter by status'),
      iteration: z.string().optional().describe('Filter by iteration'),
      all: z.boolean().optional().describe('Show all iterations'),
    },
    (args) => {
      return handleSearchItems(backend, args);
    },
  );

  server.tool(
    'set_backend',
    'Set the backend type for this project',
    {
      backend: z
        .string()
        .describe(`Backend type: ${VALID_BACKENDS.join(', ')}`),
    },
    (args) => {
      return handleSetBackend(root, args);
    },
  );

  if (caps.comments) {
    server.tool(
      'add_comment',
      'Add a comment to a work item',
      {
        id: z.string().describe('Work item ID'),
        text: z.string().describe('Comment text'),
        author: z.string().optional().describe('Comment author'),
      },
      (args) => {
        return handleAddComment(backend, args);
      },
    );
  }

  if (caps.iterations) {
    server.tool(
      'set_iteration',
      'Set the current iteration',
      {
        name: z.string().describe('Iteration name'),
      },
      (args) => {
        return handleSetIteration(backend, args);
      },
    );
  }

  if (caps.relationships) {
    server.tool(
      'get_children',
      'Get child items of a work item',
      {
        id: z.string().describe('Work item ID'),
      },
      (args) => {
        return handleGetChildren(backend, args);
      },
    );

    server.tool(
      'get_dependents',
      'Get items that depend on a work item',
      {
        id: z.string().describe('Work item ID'),
      },
      (args) => {
        return handleGetDependents(backend, args);
      },
    );

    server.tool(
      'get_item_tree',
      'Get work items as a hierarchical tree',
      {
        type: z.string().optional().describe('Filter by work item type'),
        status: z.string().optional().describe('Filter by status'),
        iteration: z.string().optional().describe('Filter by iteration'),
        all: z.boolean().optional().describe('Show all iterations'),
      },
      (args) => {
        return handleGetItemTree(backend, args);
      },
    );
  }
}

function isTicProject(root: string): boolean {
  return fs.existsSync(path.join(root, '.tic'));
}

export async function startMcpServer(): Promise<void> {
  const root = process.cwd();
  const server = new McpServer({
    name: 'tic',
    version: '0.1.0',
  });

  let backend: Backend | null = isTicProject(root)
    ? createBackendFromConfig(root)
    : null;
  const pendingDeletes = createDeleteTracker();

  const guardedBackend = new Proxy({} as Backend, {
    get(_target, prop: string | symbol) {
      if (!backend) {
        // Re-check after init_project may have created the project
        if (isTicProject(root)) {
          backend = createBackendFromConfig(root);
        } else {
          throw new Error(
            'Not a tic project. Use the init_project tool first.',
          );
        }
      }
      return (backend as unknown as Record<string | symbol, unknown>)[prop];
    },
  });

  registerTools(server, guardedBackend, pendingDeletes, root);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('tic MCP server running on stdio');
}
