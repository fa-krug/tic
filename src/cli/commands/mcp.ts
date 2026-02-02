import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  createBackendWithSync,
  VALID_BACKENDS,
} from '../../backends/factory.js';
import { SyncQueueStore } from '../../sync/queue.js';
import type { SyncManager } from '../../sync/SyncManager.js';
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

export async function handleInitProject(root: string): Promise<ToolResult> {
  try {
    const result = await runInit(root);
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

export async function handleGetConfig(
  backend: Backend,
  root: string,
): Promise<ToolResult> {
  try {
    const config = await readConfig(root);
    return success({
      backend: config.backend,
      statuses: await backend.getStatuses(),
      types: await backend.getWorkItemTypes(),
      iterations: await backend.getIterations(),
      currentIteration: await backend.getCurrentIteration(),
      capabilities: backend.getCapabilities(),
    });
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}

export async function handleSetBackend(
  root: string,
  args: { backend: string },
): Promise<ToolResult> {
  try {
    if (!(VALID_BACKENDS as readonly string[]).includes(args.backend)) {
      return error(
        `Invalid backend "${args.backend}". Valid backends: ${VALID_BACKENDS.join(', ')}`,
      );
    }
    const config = await readConfig(root);
    config.backend = args.backend;
    await writeConfig(root, config);
    return success({ backend: args.backend });
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}

export async function handleListItems(
  backend: Backend,
  args: ListItemsArgs,
): Promise<ToolResult> {
  try {
    const items = await runItemList(backend, {
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

export async function handleShowItem(
  backend: Backend,
  args: { id: string },
): Promise<ToolResult> {
  try {
    const item = await runItemShow(backend, args.id);
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

export async function handleCreateItem(
  backend: Backend,
  args: CreateItemArgs,
): Promise<ToolResult> {
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
    const item = await runItemCreate(backend, args.title, opts);
    return success(item);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return error(message);
  }
}

export async function handleUpdateItem(
  backend: Backend,
  args: UpdateItemArgs,
): Promise<ToolResult> {
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
    const item = await runItemUpdate(backend, args.id, opts);
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

export async function handleDeleteItem(
  backend: Backend,
  args: { id: string },
  pendingDeletes: DeleteTracker,
): Promise<ToolResult> {
  try {
    const item = await backend.getWorkItem(args.id);
    const caps = backend.getCapabilities();
    const children = caps.relationships
      ? await backend.getChildren(args.id)
      : [];
    const dependents = caps.relationships
      ? await backend.getDependents(args.id)
      : [];
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

export async function handleConfirmDelete(
  backend: Backend,
  args: { id: string },
  pendingDeletes: DeleteTracker,
): Promise<ToolResult> {
  if (!pendingDeletes.has(args.id)) {
    return error(
      `No pending delete for item ${args.id}. Call delete_item first to preview.`,
    );
  }
  try {
    await runItemDelete(backend, args.id);
    pendingDeletes.delete(args.id);
    return success({ deleted: args.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return error(message);
  }
}

export async function handleAddComment(
  backend: Backend,
  args: { id: string; text: string; author?: string },
): Promise<ToolResult> {
  try {
    const comment = await runItemComment(backend, args.id, args.text, {
      author: args.author,
    });
    return success(comment);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return error(message);
  }
}

export async function handleSetIteration(
  backend: Backend,
  args: { name: string },
): Promise<ToolResult> {
  try {
    await runIterationSet(backend, args.name);
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

export async function handleSearchItems(
  backend: Backend,
  args: SearchItemsArgs,
): Promise<ToolResult> {
  try {
    const items = await runItemList(backend, {
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

export async function handleGetChildren(
  backend: Backend,
  args: { id: string },
): Promise<ToolResult> {
  try {
    const children = await backend.getChildren(args.id);
    return success(children);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return error(message);
  }
}

export async function handleGetDependents(
  backend: Backend,
  args: { id: string },
): Promise<ToolResult> {
  try {
    const dependents = await backend.getDependents(args.id);
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

export async function handleGetItemTree(
  backend: Backend,
  args: ListItemsArgs,
): Promise<ToolResult> {
  try {
    const opts: ItemListOptions = {};
    if (args.type) opts.type = args.type;
    if (args.status) opts.status = args.status;
    if (args.iteration) opts.iteration = args.iteration;
    if (args.all) opts.all = args.all;
    const items = await runItemList(backend, opts);

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

export interface SyncState {
  syncManager: SyncManager | null;
  queueStore: SyncQueueStore | null;
}

export function registerTools(
  server: McpServer,
  backend: Backend,
  pendingDeletes: DeleteTracker,
  root: string,
  syncState?: SyncState,
): void {
  const caps = backend.getCapabilities();

  server.tool('get_config', 'Get project configuration', async () => {
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
    async (args) => {
      return handleListItems(backend, args);
    },
  );

  server.tool(
    'show_item',
    'Show work item details',
    {
      id: z.string().describe('Work item ID'),
    },
    async (args) => {
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
      ...(caps.fields.parent
        ? { parent: z.string().optional().describe('Parent item ID') }
        : {}),
      ...(caps.fields.dependsOn
        ? {
            depends_on: z
              .array(z.string())
              .optional()
              .describe('Dependency item IDs'),
          }
        : {}),
      description: z.string().optional().describe('Work item description'),
    },
    async (args) => {
      const result = await handleCreateItem(backend, args);
      if (!result.isError && syncState?.queueStore && syncState?.syncManager) {
        const data = JSON.parse(result.content[0]!.text) as { id: string };
        await syncState.queueStore.append({
          action: 'create',
          itemId: data.id,
          timestamp: new Date().toISOString(),
        });
        const pushResult = await syncState.syncManager.pushPending();
        const resolvedId = pushResult.idMappings.get(data.id);
        if (resolvedId) {
          const resolved = await backend.getWorkItem(resolvedId);
          return success(resolved);
        }
      }
      return result;
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
      ...(caps.fields.parent
        ? {
            parent: z
              .string()
              .nullable()
              .optional()
              .describe('Parent item ID (null to clear)'),
          }
        : {}),
      ...(caps.fields.dependsOn
        ? {
            depends_on: z
              .array(z.string())
              .optional()
              .describe('Dependency item IDs'),
          }
        : {}),
      description: z.string().optional().describe('Work item description'),
    },
    async (args) => {
      const result = await handleUpdateItem(backend, args);
      if (!result.isError && syncState?.queueStore && syncState?.syncManager) {
        const data = JSON.parse(result.content[0]!.text) as { id: string };
        await syncState.queueStore.append({
          action: 'update',
          itemId: data.id,
          timestamp: new Date().toISOString(),
        });
        await syncState.syncManager.pushPending();
      }
      return result;
    },
  );

  server.tool(
    'delete_item',
    'Preview deleting a work item (requires confirm_delete to finalize)',
    {
      id: z.string().describe('Work item ID'),
    },
    async (args) => {
      return handleDeleteItem(backend, args, pendingDeletes);
    },
  );

  server.tool(
    'confirm_delete',
    'Confirm and execute a pending item deletion',
    {
      id: z.string().describe('Work item ID'),
    },
    async (args) => {
      const result = await handleConfirmDelete(backend, args, pendingDeletes);
      if (!result.isError && syncState?.queueStore && syncState?.syncManager) {
        await syncState.queueStore.append({
          action: 'delete',
          itemId: args.id,
          timestamp: new Date().toISOString(),
        });
        await syncState.syncManager.pushPending();
      }
      return result;
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
    async (args) => {
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
    async (args) => {
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
      async (args) => {
        const result = await handleAddComment(backend, args);
        if (
          !result.isError &&
          syncState?.queueStore &&
          syncState?.syncManager
        ) {
          const data = JSON.parse(result.content[0]!.text) as {
            author: string;
            body: string;
          };
          await syncState.queueStore.append({
            action: 'comment',
            itemId: args.id,
            timestamp: new Date().toISOString(),
            commentData: { author: data.author, body: data.body },
          });
          await syncState.syncManager.pushPending();
        }
        return result;
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
      async (args) => {
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
      async (args) => {
        return handleGetChildren(backend, args);
      },
    );

    server.tool(
      'get_dependents',
      'Get items that depend on a work item',
      {
        id: z.string().describe('Work item ID'),
      },
      async (args) => {
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
      async (args) => {
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

  let backend: Backend | null = null;
  const syncState: SyncState = { syncManager: null, queueStore: null };

  if (isTicProject(root)) {
    const setup = await createBackendWithSync(root);
    backend = setup.backend;
    syncState.syncManager = setup.syncManager;
    syncState.queueStore = syncState.syncManager
      ? new SyncQueueStore(root)
      : null;
  }

  const pendingDeletes = createDeleteTracker();

  const guardedBackend = new Proxy({} as Backend, {
    get(_target, prop: string | symbol) {
      if (!backend) {
        throw new Error('Not a tic project. Use the init_project tool first.');
      }
      return (backend as unknown as Record<string | symbol, unknown>)[prop];
    },
  });

  // Register init_project separately so it can re-initialize the backend
  server.tool('init_project', 'Initialize a new tic project', async () => {
    const result = await handleInitProject(root);
    if (!result.isError && !backend && isTicProject(root)) {
      const setup = await createBackendWithSync(root);
      backend = setup.backend;
      syncState.syncManager = setup.syncManager;
      syncState.queueStore = syncState.syncManager
        ? new SyncQueueStore(root)
        : null;
    }
    return result;
  });

  registerTools(server, guardedBackend, pendingDeletes, root, syncState);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('tic MCP server running on stdio');
}
