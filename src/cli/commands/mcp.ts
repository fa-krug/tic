import { VERSION } from '../../version.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  createBackend,
  createBackendWithSync,
  VALID_BACKENDS,
} from '../../backends/factory.js';
import { AuthError } from '../../backends/shared/api-client.js';
import type { SyncQueueAdapter } from '../../sync/types.js';
import type { SyncManager } from '../../sync/SyncManager.js';
import { configStore } from '../../stores/configStore.js';
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
import {
  runPrList,
  runPrShow,
  runPrCreate,
  runPrMerge,
  runPrClose,
  runPrLink,
  runPrUnlink,
} from './pr.js';
import type { PrCreateOptions } from './pr.js';
import { isPrBackend } from '../../backends/types.js';
import { isGitRepo } from '../../git.js';

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
  _root: string, // eslint-disable-line @typescript-eslint/no-unused-vars
): Promise<ToolResult> {
  try {
    const config = configStore.getState().config;
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
  _root: string,
  args: { backend: string },
): Promise<ToolResult> {
  try {
    if (!(VALID_BACKENDS as readonly string[]).includes(args.backend)) {
      return error(
        `Invalid backend "${args.backend}". Valid backends: ${VALID_BACKENDS.join(', ')}`,
      );
    }
    await configStore.getState().update({ backend: args.backend });
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
      message: 'Use tic-confirm_delete to proceed with deletion.',
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

    const nodeMap = new Map<number, TreeNode>();
    for (const item of items) {
      nodeMap.set(item.rowId, {
        id: item.id ?? String(item.rowId),
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
      const node = nodeMap.get(item.rowId)!;
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

export async function handleListPrs(
  backend: Backend,
  args: { status?: string },
): Promise<ToolResult> {
  try {
    const prs = await runPrList(backend, { status: args.status });
    return success(prs);
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}

export async function handleShowPr(
  backend: Backend,
  args: { id: string },
): Promise<ToolResult> {
  try {
    const pr = await runPrShow(backend, args.id);
    return success(pr);
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}

export async function handleCreatePr(
  backend: Backend,
  args: {
    title: string;
    sourceBranch: string;
    targetBranch?: string;
    linkedItems?: string;
  },
): Promise<ToolResult> {
  try {
    const opts: PrCreateOptions = {
      title: args.title,
      source: args.sourceBranch,
      target: args.targetBranch,
      link: args.linkedItems,
    };
    const pr = await runPrCreate(backend, opts);
    return success(pr);
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}

export async function handleMergePr(
  backend: Backend,
  args: { id: string },
): Promise<ToolResult> {
  try {
    const pr = await runPrMerge(backend, args.id);
    return success(pr);
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}

export async function handleClosePr(
  backend: Backend,
  args: { id: string },
): Promise<ToolResult> {
  try {
    const pr = await runPrClose(backend, args.id);
    return success(pr);
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}

export async function handleLinkPr(
  backend: Backend,
  args: { prId: string; itemId: string },
): Promise<ToolResult> {
  try {
    await runPrLink(backend, args.prId, args.itemId);
    return success({ linked: { prId: args.prId, itemId: args.itemId } });
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}

export async function handleUnlinkPr(
  backend: Backend,
  args: { prId: string; itemId: string },
): Promise<ToolResult> {
  try {
    await runPrUnlink(backend, args.prId, args.itemId);
    return success({ unlinked: { prId: args.prId, itemId: args.itemId } });
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}

export async function handleGetLinkedPrs(
  backend: Backend,
  args: { itemId: string },
): Promise<ToolResult> {
  try {
    if (!isPrBackend(backend)) {
      return error(
        'Pull request operations require a PR-capable backend (e.g., GitHub)',
      );
    }
    const prs = await backend.getLinkedPullRequests(args.itemId);
    return success(prs);
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}

export interface SyncState {
  syncManager: SyncManager | null;
  queue: SyncQueueAdapter | null;
}

export function registerTools(
  server: McpServer,
  backend: Backend,
  pendingDeletes: DeleteTracker,
  root: string,
  syncState?: SyncState,
): void {
  const caps = backend.getCapabilities();

  server.tool('tic-get_config', 'Get project configuration', async () => {
    return handleGetConfig(backend, root);
  });

  server.tool(
    'tic-list_items',
    'List work items with optional filters',
    {
      type: z.string().optional().describe('Filter by work item type'),
      status: z.string().optional().describe('Filter by status'),
      iteration: z.string().optional().describe('Filter by iteration'),
      all: z.boolean().optional().describe('Show all iterations'),
    },
    async (args) => {
      if (syncState?.syncManager) await syncState.syncManager.sync();
      return handleListItems(backend, args);
    },
  );

  server.tool(
    'tic-show_item',
    'Show work item details',
    {
      id: z.string().describe('Work item ID'),
    },
    async (args) => {
      return handleShowItem(backend, args);
    },
  );

  server.tool(
    'tic-create_item',
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
      if (!result.isError && syncState?.queue && syncState?.syncManager) {
        const data = JSON.parse(result.content[0]!.text) as {
          rowId: number;
        };
        await syncState.queue.append({
          action: 'create',
          itemRowId: data.rowId,
          timestamp: new Date().toISOString(),
        });
        const pushResult = await syncState.syncManager.pushPending();
        const resolvedId = pushResult.idMappings.get(data.rowId);
        if (resolvedId) {
          const resolved = await backend.getWorkItem(resolvedId);
          return success(resolved);
        }
      }
      return result;
    },
  );

  server.tool(
    'tic-update_item',
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
      if (!result.isError && syncState?.queue && syncState?.syncManager) {
        const data = JSON.parse(result.content[0]!.text) as {
          rowId: number;
        };
        await syncState.queue.append({
          action: 'update',
          itemRowId: data.rowId,
          timestamp: new Date().toISOString(),
        });
        await syncState.syncManager.pushPending();
      }
      return result;
    },
  );

  server.tool(
    'tic-delete_item',
    'Preview deleting a work item (requires tic-confirm_delete to finalize)',
    {
      id: z.string().describe('Work item ID'),
    },
    async (args) => {
      return handleDeleteItem(backend, args, pendingDeletes);
    },
  );

  server.tool(
    'tic-confirm_delete',
    'Confirm and execute a pending item deletion',
    {
      id: z.string().describe('Work item ID'),
    },
    async (args) => {
      // Resolve rowId before delete (item won't exist after)
      let itemRowId: number | undefined;
      if (syncState?.queue && syncState?.syncManager) {
        try {
          const item = await backend.getWorkItem(args.id);
          itemRowId = item.rowId;
        } catch {
          // Item may not be found if already deleted
        }
      }
      const result = await handleConfirmDelete(backend, args, pendingDeletes);
      if (
        !result.isError &&
        syncState?.queue &&
        syncState?.syncManager &&
        itemRowId !== undefined
      ) {
        await syncState.queue.append({
          action: 'delete',
          itemRowId,
          timestamp: new Date().toISOString(),
        });
        await syncState.syncManager.pushPending();
      }
      return result;
    },
  );

  server.tool(
    'tic-search_items',
    'Search work items by text query',
    {
      query: z.string().describe('Search query'),
      type: z.string().optional().describe('Filter by work item type'),
      status: z.string().optional().describe('Filter by status'),
      iteration: z.string().optional().describe('Filter by iteration'),
      all: z.boolean().optional().describe('Show all iterations'),
    },
    async (args) => {
      if (syncState?.syncManager) await syncState.syncManager.sync();
      return handleSearchItems(backend, args);
    },
  );

  server.tool(
    'tic-set_backend',
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
      'tic-add_comment',
      'Add a comment to a work item',
      {
        id: z.string().describe('Work item ID'),
        text: z.string().describe('Comment text'),
        author: z.string().optional().describe('Comment author'),
      },
      async (args) => {
        const result = await handleAddComment(backend, args);
        if (!result.isError && syncState?.queue && syncState?.syncManager) {
          const data = JSON.parse(result.content[0]!.text) as {
            author: string;
            body: string;
          };
          const item = await backend.getWorkItem(args.id);
          await syncState.queue.append({
            action: 'comment',
            itemRowId: item.rowId,
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
      'tic-set_iteration',
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
      'tic-get_children',
      'Get child items of a work item',
      {
        id: z.string().describe('Work item ID'),
      },
      async (args) => {
        return handleGetChildren(backend, args);
      },
    );

    server.tool(
      'tic-get_dependents',
      'Get items that depend on a work item',
      {
        id: z.string().describe('Work item ID'),
      },
      async (args) => {
        return handleGetDependents(backend, args);
      },
    );

    server.tool(
      'tic-get_item_tree',
      'Get work items as a hierarchical tree',
      {
        type: z.string().optional().describe('Filter by work item type'),
        status: z.string().optional().describe('Filter by status'),
        iteration: z.string().optional().describe('Filter by iteration'),
        all: z.boolean().optional().describe('Show all iterations'),
      },
      async (args) => {
        if (syncState?.syncManager) await syncState.syncManager.sync();
        return handleGetItemTree(backend, args);
      },
    );
  }

  // PR tools — available if backend supports PRs
  if (isPrBackend(backend)) {
    server.tool(
      'tic-list_prs',
      'List pull requests with optional status filter',
      {
        status: z
          .string()
          .optional()
          .describe('Filter by status (open, merged, closed, draft)'),
      },
      async (args) => {
        return handleListPrs(backend, args);
      },
    );

    server.tool(
      'tic-show_pr',
      'Show pull request details',
      {
        id: z.string().describe('Pull request ID'),
      },
      async (args) => {
        return handleShowPr(backend, args);
      },
    );

    server.tool(
      'tic-create_pr',
      'Create a pull request (requires remote backend)',
      {
        title: z.string().describe('PR title'),
        sourceBranch: z.string().describe('Source branch'),
        targetBranch: z.string().optional().describe('Target branch'),
        linkedItems: z
          .string()
          .optional()
          .describe('Comma-separated work item IDs to link'),
      },
      async (args) => {
        return handleCreatePr(backend, args);
      },
    );

    server.tool(
      'tic-merge_pr',
      'Merge a pull request',
      {
        id: z.string().describe('Pull request ID'),
      },
      async (args) => {
        return handleMergePr(backend, args);
      },
    );

    server.tool(
      'tic-close_pr',
      'Close a pull request',
      {
        id: z.string().describe('Pull request ID'),
      },
      async (args) => {
        return handleClosePr(backend, args);
      },
    );

    server.tool(
      'tic-link_pr',
      'Link a pull request to a work item',
      {
        prId: z.string().describe('Pull request ID'),
        itemId: z.string().describe('Work item ID'),
      },
      async (args) => {
        return handleLinkPr(backend, args);
      },
    );

    server.tool(
      'tic-unlink_pr',
      'Unlink a pull request from a work item',
      {
        prId: z.string().describe('Pull request ID'),
        itemId: z.string().describe('Work item ID'),
      },
      async (args) => {
        return handleUnlinkPr(backend, args);
      },
    );

    server.tool(
      'tic-get_linked_prs',
      'Get pull requests linked to a work item',
      {
        itemId: z.string().describe('Work item ID'),
      },
      async (args) => {
        return handleGetLinkedPrs(backend, args);
      },
    );
  }

  // Branch tools — available if in a git repo
  if (isGitRepo(root)) {
    server.tool(
      'tic-list_branches',
      'List git branches with linked work items and worktree status',
      {},
      async () => {
        const items = await backend.listWorkItems();
        const { runBranchList } = await import('./branch.js');
        const branches = runBranchList(root, items);
        return {
          content: [{ type: 'text', text: JSON.stringify(branches, null, 2) }],
        };
      },
    );

    server.tool(
      'tic-switch_branch',
      'Switch to a git branch',
      {
        name: z.string().describe('Branch name to switch to'),
      },
      async (args) => {
        const { runBranchSwitch } = await import('./branch.js');
        const result = runBranchSwitch(args.name, root);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
      },
    );

    server.tool(
      'tic-create_branch',
      'Create a new git branch',
      {
        name: z.string().describe('Branch name to create'),
      },
      async (args) => {
        const { runBranchCreate } = await import('./branch.js');
        const result = runBranchCreate(args.name, root);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
      },
    );

    server.tool(
      'tic-delete_branch',
      'Delete a git branch and its worktree if present',
      {
        name: z.string().describe('Branch name to delete'),
        force: z
          .boolean()
          .optional()
          .describe('Force delete if not fully merged'),
      },
      async (args) => {
        const { runBranchDelete } = await import('./branch.js');
        const result = await runBranchDelete(
          args.name,
          root,
          args.force ?? false,
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
      },
    );

    server.tool(
      'tic-merge_branch',
      'Merge a git branch into the current branch',
      {
        name: z.string().describe('Branch name to merge'),
      },
      async (args) => {
        const { runBranchMerge } = await import('./branch.js');
        const result = await runBranchMerge(args.name, root);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
      },
    );

    server.tool(
      'tic-push_branch',
      'Push a git branch to remote',
      {
        name: z
          .string()
          .optional()
          .describe('Branch name (defaults to current)'),
      },
      async (args) => {
        const { runBranchPush } = await import('./branch.js');
        const result = await runBranchPush(args.name, root);
        return {
          content: [{ type: 'text', text: JSON.stringify(result) }],
        };
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
    version: VERSION,
  });

  let backend: Backend | null = null;
  const syncState: SyncState = { syncManager: null, queue: null };

  if (isTicProject(root)) {
    try {
      const setup = await createBackendWithSync(root, { skipAuth: true });
      backend = setup.backend;
      syncState.syncManager = setup.syncManager;
      syncState.queue = setup.queue;
    } catch (err) {
      if (err instanceof AuthError) {
        // Remote backend requires auth — fall back to local-only so local operations still work
        console.error(err.message);
        backend = await createBackend(root);
      } else {
        throw err;
      }
    }
  }

  const pendingDeletes = createDeleteTracker();

  const guardedBackend = new Proxy({} as Backend, {
    get(_target, prop: string | symbol) {
      if (!backend) {
        throw new Error(
          'Not a tic project. Use the tic-init_project tool first.',
        );
      }
      return (backend as unknown as Record<string | symbol, unknown>)[prop];
    },
  });

  // Register init_project separately so it can re-initialize the backend
  server.tool('tic-init_project', 'Initialize a new tic project', async () => {
    const result = await handleInitProject(root);
    if (!result.isError && !backend && isTicProject(root)) {
      try {
        const setup = await createBackendWithSync(root, { skipAuth: true });
        backend = setup.backend;
        syncState.syncManager = setup.syncManager;
        syncState.queue = setup.queue;
      } catch (err) {
        if (err instanceof AuthError) {
          // Remote backend requires auth — fall back to local-only
          backend = await createBackend(root);
          return error(err.message);
        }
        throw err;
      }
    }
    return result;
  });

  registerTools(server, guardedBackend, pendingDeletes, root, syncState);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('tic MCP server running on stdio');
}
