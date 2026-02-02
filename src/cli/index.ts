import { Command } from 'commander';
import {
  createBackend as createBackendFromConfig,
  createBackendWithSync,
  detectBackend,
  VALID_BACKENDS,
} from '../backends/factory.js';
import type { Backend, BackendCapabilities } from '../backends/types.js';
import { GitHubBackend } from '../backends/github/index.js';
import { GitLabBackend } from '../backends/gitlab/index.js';
import { AzureDevOpsBackend } from '../backends/ado/index.js';
import { readConfigSync } from '../backends/local/config.js';
import { SyncQueueStore } from '../sync/queue.js';
import type { SyncManager } from '../sync/SyncManager.js';
import { formatTsvRow, formatTsvKeyValue, formatJson } from './format.js';
import { runInit } from './commands/init.js';
import { runConfigGet, runConfigSet } from './commands/config.js';
import {
  runItemList,
  runItemShow,
  runItemCreate,
  runItemUpdate,
  runItemDelete,
  runItemOpen,
  runItemComment,
  type ItemListOptions,
  type ItemCreateOptions,
  type ItemUpdateOptions,
  type ItemCommentOptions,
} from './commands/item.js';
import { runIterationList, runIterationSet } from './commands/iteration.js';
import { startMcpServer } from './commands/mcp.js';
import type { WorkItem } from '../types.js';
import fs from 'node:fs';
import path from 'node:path';

interface GlobalOpts {
  json?: boolean;
  quiet?: boolean;
}

function itemToTsvRow(item: WorkItem): string {
  return formatTsvRow([
    String(item.id),
    item.type,
    item.status,
    item.priority,
    item.title,
    item.iteration,
  ]);
}

function itemToTsvDetail(
  item: WorkItem,
  caps?: BackendCapabilities | null,
): string {
  const pairs: [string, string][] = [
    ['id', String(item.id)],
    ['title', item.title],
    ['type', item.type],
    ['status', item.status],
    ['priority', item.priority],
    ['iteration', item.iteration],
    ['assignee', item.assignee],
    ['labels', item.labels.join(',')],
  ];
  if (!caps || caps.fields.parent)
    pairs.push(['parent', item.parent !== null ? String(item.parent) : '']);
  if (!caps || caps.fields.dependsOn)
    pairs.push(['depends_on', item.dependsOn.join(',')]);
  pairs.push(['created', item.created], ['updated', item.updated]);
  let output = formatTsvKeyValue(pairs);
  if (item.description) {
    output += '\n\n' + item.description;
  }
  return output;
}

function readStdin(): string {
  if (process.stdin.isTTY) return '';
  return fs.readFileSync(0, 'utf-8').trim();
}

export function requireTicProject(root: string): void {
  const ticDir = path.join(root, '.tic');
  if (!fs.existsSync(ticDir)) {
    throw new Error(
      "Not a tic project (no .tic/ directory found). Run 'tic init' first.",
    );
  }
}

async function createBackend(): Promise<Backend> {
  requireTicProject(process.cwd());
  return createBackendFromConfig(process.cwd());
}

async function createBackendAndSync(): Promise<{
  backend: Backend;
  syncManager: SyncManager | null;
  queueStore: SyncQueueStore | null;
}> {
  requireTicProject(process.cwd());
  const { backend, syncManager } = await createBackendWithSync(process.cwd());
  const queueStore = syncManager ? new SyncQueueStore(process.cwd()) : null;
  return { backend, syncManager, queueStore };
}

function tryGetCapabilities(): BackendCapabilities | null {
  try {
    requireTicProject(process.cwd());
    const config = readConfigSync(process.cwd());
    const backendType = config.backend ?? 'local';
    switch (backendType) {
      case 'github':
        return new GitHubBackend(process.cwd()).getCapabilities();
      case 'gitlab':
        return new GitLabBackend(process.cwd()).getCapabilities();
      case 'azure':
        return new AzureDevOpsBackend(process.cwd()).getCapabilities();
      default:
        return null; // local — show all options
    }
  } catch {
    return null;
  }
}

function output(
  data: unknown,
  tsvFn: () => string,
  opts: { json?: boolean; quiet?: boolean },
): void {
  if (opts.quiet) return;
  if (opts.json) {
    console.log(formatJson(data));
  } else {
    console.log(tsvFn());
  }
}

function handleError(err: unknown, json?: boolean): never {
  const message = err instanceof Error ? err.message : String(err);
  if (json) {
    console.error(formatJson({ error: message }));
  } else {
    console.error(`Error: ${message}`);
  }
  process.exit(1);
}

export function createProgram(): Command {
  const program = new Command();
  program.name('tic').version('0.1.0').description('Terminal issue tracker');

  const caps = tryGetCapabilities();

  // tic init
  program
    .command('init')
    .description('Initialize a new .tic project')
    .option(
      '--backend <backend>',
      'Backend type (local, github, gitlab, azure)',
    )
    .action(async (opts: { backend?: string }) => {
      const parentOpts = program.opts<GlobalOpts>();
      try {
        let backend = opts.backend;
        if (!backend) {
          const detected = detectBackend(process.cwd());
          if (process.stdin.isTTY) {
            console.log(`Detected backend: ${detected}`);
            console.log(`Available backends: ${VALID_BACKENDS.join(', ')}`);
            console.log(`Using: ${detected} (pass --backend to override)`);
          }
          backend = detected;
        }
        if (!(VALID_BACKENDS as readonly string[]).includes(backend)) {
          throw new Error(
            `Invalid backend "${backend}". Valid: ${VALID_BACKENDS.join(', ')}`,
          );
        }
        const result = await runInit(process.cwd(), backend);
        if (result.alreadyExists) {
          console.log('Already initialized in .tic/');
        } else {
          output(
            { initialized: true, backend },
            () => `Initialized .tic/ with backend: ${backend}`,
            parentOpts,
          );
        }
      } catch (err) {
        handleError(err, parentOpts.json);
      }
    });

  // tic item ...
  const item = program.command('item').description('Manage work items');

  item
    .command('list')
    .description('List work items')
    .option('--status <status>', 'Filter by status')
    .option('--type <type>', 'Filter by work item type')
    .option('--iteration <name>', 'Filter by iteration')
    .option('--all', 'Show all iterations')
    .option('--headers', 'Include column headers')
    .action(async (opts: ItemListOptions & { headers?: boolean }) => {
      const parentOpts = program.opts<GlobalOpts>();
      try {
        const backend = await createBackend();
        const items = await runItemList(backend, opts);
        if (parentOpts.quiet) return;
        if (parentOpts.json) {
          console.log(formatJson(items));
        } else {
          if (opts.headers) {
            console.log(
              formatTsvRow([
                'id',
                'type',
                'status',
                'priority',
                'title',
                'iteration',
              ]),
            );
          }
          for (const i of items) {
            console.log(itemToTsvRow(i));
          }
        }
      } catch (err) {
        handleError(err, parentOpts.json);
      }
    });

  item
    .command('show')
    .description('Show work item details')
    .argument('<id>', 'Work item ID')
    .action(async (idStr: string) => {
      const parentOpts = program.opts<GlobalOpts>();
      try {
        const backend = await createBackend();
        const wi = await runItemShow(backend, idStr);
        output(
          wi,
          () => itemToTsvDetail(wi, backend.getCapabilities()),
          parentOpts,
        );
      } catch (err) {
        handleError(err, parentOpts.json);
      }
    });

  item
    .command('open')
    .description('Open a work item in an external editor or browser')
    .argument('<id>', 'Work item ID')
    .action(async (idStr: string) => {
      const parentOpts = program.opts<GlobalOpts>();
      try {
        const backend = await createBackend();
        await runItemOpen(backend, idStr);
      } catch (err) {
        handleError(err, parentOpts.json);
      }
    });

  const create = item
    .command('create')
    .description('Create a new work item')
    .argument('<title>', 'Work item title')
    .option('--status <status>', 'Initial status');
  if (!caps || caps.customTypes)
    create.option('--type <type>', 'Work item type');
  if (!caps || caps.fields.priority)
    create.option('--priority <priority>', 'Priority level');
  if (!caps || caps.fields.assignee)
    create.option('--assignee <name>', 'Assignee');
  if (!caps || caps.fields.labels)
    create.option('--labels <labels>', 'Comma-separated labels');
  if (!caps || caps.iterations)
    create.option('--iteration <name>', 'Iteration');
  if (!caps || caps.fields.parent)
    create.option('--parent <id>', 'Parent item ID');
  if (!caps || caps.fields.dependsOn)
    create.option('--depends-on <ids>', 'Comma-separated dependency IDs');
  create.action(async (title: string, opts: ItemCreateOptions) => {
    const parentOpts = program.opts<GlobalOpts>();
    try {
      const { backend, syncManager, queueStore } = await createBackendAndSync();
      const description = readStdin();
      const wi = await runItemCreate(backend, title, {
        ...opts,
        dependsOn: opts.dependsOn,
        description,
      });
      if (queueStore && syncManager) {
        await queueStore.append({
          action: 'create',
          itemId: wi.id,
          timestamp: new Date().toISOString(),
        });
        await syncManager.pushPending();
      }
      output(wi, () => itemToTsvRow(wi), parentOpts);
    } catch (err) {
      handleError(err, parentOpts.json);
    }
  });

  const update = item
    .command('update')
    .description('Update a work item')
    .argument('<id>', 'Work item ID')
    .option('--title <title>', 'New title')
    .option('--status <status>', 'Status');
  if (!caps || caps.customTypes)
    update.option('--type <type>', 'Work item type');
  if (!caps || caps.fields.priority)
    update.option('--priority <priority>', 'Priority level');
  if (!caps || caps.fields.assignee)
    update.option('--assignee <name>', 'Assignee');
  if (!caps || caps.fields.labels)
    update.option('--labels <labels>', 'Comma-separated labels');
  if (!caps || caps.iterations)
    update.option('--iteration <name>', 'Iteration');
  if (!caps || caps.fields.parent)
    update.option('--parent <id>', 'Parent item ID');
  if (!caps || caps.fields.dependsOn)
    update.option('--depends-on <ids>', 'Comma-separated dependency IDs');
  update.action(async (idStr: string, opts: ItemUpdateOptions) => {
    const parentOpts = program.opts<GlobalOpts>();
    try {
      const { backend, syncManager, queueStore } = await createBackendAndSync();
      const description = readStdin();
      const updateOpts: ItemUpdateOptions = {
        ...opts,
        dependsOn: opts.dependsOn,
        ...(description ? { description } : {}),
      };
      const wi = await runItemUpdate(backend, idStr, updateOpts);
      if (queueStore && syncManager) {
        await queueStore.append({
          action: 'update',
          itemId: wi.id,
          timestamp: new Date().toISOString(),
        });
        await syncManager.pushPending();
      }
      output(wi, () => itemToTsvRow(wi), parentOpts);
    } catch (err) {
      handleError(err, parentOpts.json);
    }
  });

  item
    .command('delete')
    .description('Delete a work item')
    .argument('<id>', 'Work item ID')
    .action(async (idStr: string) => {
      const parentOpts = program.opts<GlobalOpts>();
      try {
        const { backend, syncManager, queueStore } =
          await createBackendAndSync();
        await runItemDelete(backend, idStr);
        if (queueStore && syncManager) {
          await queueStore.append({
            action: 'delete',
            itemId: idStr,
            timestamp: new Date().toISOString(),
          });
          await syncManager.pushPending();
        }
        if (!parentOpts.quiet) {
          if (parentOpts.json) {
            console.log(formatJson({ deleted: idStr }));
          } else {
            console.log(`Deleted item ${idStr}`);
          }
        }
      } catch (err) {
        handleError(err, parentOpts.json);
      }
    });

  if (!caps || caps.comments) {
    item
      .command('comment')
      .description('Add a comment to a work item')
      .argument('<id>', 'Work item ID')
      .argument('<text>', 'Comment text')
      .option('--author <name>', 'Comment author')
      .action(async (idStr: string, text: string, opts: ItemCommentOptions) => {
        const parentOpts = program.opts<GlobalOpts>();
        try {
          const { backend, syncManager, queueStore } =
            await createBackendAndSync();
          const comment = await runItemComment(backend, idStr, text, opts);
          if (queueStore && syncManager) {
            await queueStore.append({
              action: 'comment',
              itemId: idStr,
              timestamp: new Date().toISOString(),
              commentData: { author: comment.author, body: comment.body },
            });
            await syncManager.pushPending();
          }
          output(
            comment,
            () => formatTsvRow([comment.author, comment.date, comment.body]),
            parentOpts,
          );
        } catch (err) {
          handleError(err, parentOpts.json);
        }
      });
  }

  // tic iteration ...
  if (!caps || caps.iterations) {
    const iteration = program
      .command('iteration')
      .description('Manage iterations');

    iteration
      .command('list')
      .description('List iterations')
      .action(async () => {
        const parentOpts = program.opts<GlobalOpts>();
        try {
          const backend = await createBackend();
          const result = await runIterationList(backend);
          if (parentOpts.quiet) return;
          if (parentOpts.json) {
            console.log(formatJson(result));
          } else {
            for (const iter of result.iterations) {
              const marker = iter === result.current ? '*' : ' ';
              console.log(`${marker}\t${iter}`);
            }
          }
        } catch (err) {
          handleError(err, parentOpts.json);
        }
      });

    iteration
      .command('set')
      .description('Set current iteration')
      .argument('<name>', 'Iteration name')
      .action(async (name: string) => {
        const parentOpts = program.opts<GlobalOpts>();
        try {
          const backend = await createBackend();
          await runIterationSet(backend, name);
          if (!parentOpts.quiet) {
            if (parentOpts.json) {
              console.log(formatJson({ current_iteration: name }));
            } else {
              console.log(`Current iteration set to ${name}`);
            }
          }
        } catch (err) {
          handleError(err, parentOpts.json);
        }
      });
  }

  // tic config ...
  const config = program
    .command('config')
    .description('Manage project configuration');

  config
    .command('get')
    .description('Get a configuration value')
    .argument('<key>', 'Config key')
    .action(async (key: string) => {
      const parentOpts = program.opts<GlobalOpts>();
      try {
        requireTicProject(process.cwd());
        const value = await runConfigGet(process.cwd(), key);
        if (parentOpts.quiet) return;
        if (parentOpts.json) {
          console.log(formatJson({ [key]: value }));
        } else {
          console.log(Array.isArray(value) ? value.join('\n') : String(value));
        }
      } catch (err) {
        handleError(err, parentOpts.json);
      }
    });

  config
    .command('set')
    .description('Set a configuration value')
    .argument('<key>', 'Config key')
    .argument('<value>', 'Config value')
    .action(async (key: string, value: string) => {
      const parentOpts = program.opts<GlobalOpts>();
      try {
        requireTicProject(process.cwd());
        await runConfigSet(process.cwd(), key, value);
        if (!parentOpts.quiet) {
          if (parentOpts.json) {
            console.log(formatJson({ [key]: value }));
          } else {
            console.log(`Set ${key} = ${value}`);
          }
        }
      } catch (err) {
        handleError(err, parentOpts.json);
      }
    });

  // tic mcp ...
  const mcp = program
    .command('mcp')
    .description('Model Context Protocol (MCP) server for AI assistants');

  mcp
    .command('serve')
    .description(
      'Start the MCP server on stdio, exposing 14 tools for work item management',
    )
    .action(async () => {
      await startMcpServer();
    });

  // Global options
  program.option('--json', 'Output as JSON');
  program.option('--quiet', 'Suppress output on mutations');

  return program;
}

export async function runCli(argv: string[]): Promise<void> {
  const program = createProgram();
  await program.parseAsync(argv);
}
