import { Command } from 'commander';
import { LocalBackend } from '../backends/local/index.js';
import { formatTsvRow, formatTsvKeyValue, formatJson } from './format.js';
import { runInit } from './commands/init.js';
import {
  runItemList,
  runItemShow,
  runItemCreate,
  runItemUpdate,
  runItemDelete,
  runItemComment,
  type ItemListOptions,
  type ItemCreateOptions,
  type ItemUpdateOptions,
  type ItemCommentOptions,
} from './commands/item.js';
import { runIterationList, runIterationSet } from './commands/iteration.js';
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

function itemToTsvDetail(item: WorkItem): string {
  const pairs: [string, string][] = [
    ['id', String(item.id)],
    ['title', item.title],
    ['type', item.type],
    ['status', item.status],
    ['priority', item.priority],
    ['iteration', item.iteration],
    ['assignee', item.assignee],
    ['labels', item.labels.join(',')],
    ['parent', item.parent !== null ? String(item.parent) : ''],
    ['depends_on', item.dependsOn.join(',')],
    ['created', item.created],
    ['updated', item.updated],
  ];
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

function createBackend(): LocalBackend {
  requireTicProject(process.cwd());
  return new LocalBackend(process.cwd());
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

  // tic init
  program
    .command('init')
    .description('Initialize a new .tic project')
    .action(() => {
      const parentOpts = program.opts<GlobalOpts>();
      try {
        const result = runInit(process.cwd());
        if (result.alreadyExists) {
          console.log('Already initialized in .tic/');
        } else {
          output({ initialized: true }, () => 'Initialized .tic/', parentOpts);
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
    .action((opts: ItemListOptions & { headers?: boolean }) => {
      const parentOpts = program.opts<GlobalOpts>();
      try {
        const backend = createBackend();
        const items = runItemList(backend, opts);
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
    .action((idStr: string) => {
      const parentOpts = program.opts<GlobalOpts>();
      try {
        const backend = createBackend();
        const id = Number(idStr);
        if (Number.isNaN(id)) throw new Error(`Invalid ID: ${idStr}`);
        const wi = runItemShow(backend, id);
        output(wi, () => itemToTsvDetail(wi), parentOpts);
      } catch (err) {
        handleError(err, parentOpts.json);
      }
    });

  item
    .command('create')
    .description('Create a new work item')
    .argument('<title>', 'Work item title')
    .option('--type <type>', 'Work item type')
    .option('--status <status>', 'Initial status')
    .option('--priority <priority>', 'Priority level')
    .option('--assignee <name>', 'Assignee')
    .option('--labels <labels>', 'Comma-separated labels')
    .option('--iteration <name>', 'Iteration')
    .option('--parent <id>', 'Parent item ID')
    .option('--depends-on <ids>', 'Comma-separated dependency IDs')
    .action((title: string, opts: ItemCreateOptions) => {
      const parentOpts = program.opts<GlobalOpts>();
      try {
        const backend = createBackend();
        const description = readStdin();
        const wi = runItemCreate(backend, title, {
          ...opts,
          dependsOn: opts.dependsOn,
          description,
        });
        output(wi, () => itemToTsvRow(wi), parentOpts);
      } catch (err) {
        handleError(err, parentOpts.json);
      }
    });

  item
    .command('update')
    .description('Update a work item')
    .argument('<id>', 'Work item ID')
    .option('--title <title>', 'New title')
    .option('--type <type>', 'Work item type')
    .option('--status <status>', 'Status')
    .option('--priority <priority>', 'Priority level')
    .option('--assignee <name>', 'Assignee')
    .option('--labels <labels>', 'Comma-separated labels')
    .option('--iteration <name>', 'Iteration')
    .option('--parent <id>', 'Parent item ID')
    .option('--depends-on <ids>', 'Comma-separated dependency IDs')
    .action((idStr: string, opts: ItemUpdateOptions) => {
      const parentOpts = program.opts<GlobalOpts>();
      try {
        const backend = createBackend();
        const id = Number(idStr);
        if (Number.isNaN(id)) throw new Error(`Invalid ID: ${idStr}`);
        const description = readStdin();
        const updateOpts: ItemUpdateOptions = {
          ...opts,
          dependsOn: opts.dependsOn,
          ...(description ? { description } : {}),
        };
        const wi = runItemUpdate(backend, id, updateOpts);
        output(wi, () => itemToTsvRow(wi), parentOpts);
      } catch (err) {
        handleError(err, parentOpts.json);
      }
    });

  item
    .command('delete')
    .description('Delete a work item')
    .argument('<id>', 'Work item ID')
    .action((idStr: string) => {
      const parentOpts = program.opts<GlobalOpts>();
      try {
        const backend = createBackend();
        const id = Number(idStr);
        if (Number.isNaN(id)) throw new Error(`Invalid ID: ${idStr}`);
        runItemDelete(backend, id);
        if (!parentOpts.quiet) {
          if (parentOpts.json) {
            console.log(formatJson({ deleted: id }));
          } else {
            console.log(`Deleted item ${id}`);
          }
        }
      } catch (err) {
        handleError(err, parentOpts.json);
      }
    });

  item
    .command('comment')
    .description('Add a comment to a work item')
    .argument('<id>', 'Work item ID')
    .argument('<text>', 'Comment text')
    .option('--author <name>', 'Comment author')
    .action((idStr: string, text: string, opts: ItemCommentOptions) => {
      const parentOpts = program.opts<GlobalOpts>();
      try {
        const backend = createBackend();
        const id = Number(idStr);
        if (Number.isNaN(id)) throw new Error(`Invalid ID: ${idStr}`);
        const comment = runItemComment(backend, id, text, opts);
        output(
          comment,
          () => formatTsvRow([comment.author, comment.date, comment.body]),
          parentOpts,
        );
      } catch (err) {
        handleError(err, parentOpts.json);
      }
    });

  // tic iteration ...
  const iteration = program
    .command('iteration')
    .description('Manage iterations');

  iteration
    .command('list')
    .description('List iterations')
    .action(() => {
      const parentOpts = program.opts<GlobalOpts>();
      try {
        const backend = createBackend();
        const result = runIterationList(backend);
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
    .action((name: string) => {
      const parentOpts = program.opts<GlobalOpts>();
      try {
        const backend = createBackend();
        runIterationSet(backend, name);
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

  // Global options
  program.option('--json', 'Output as JSON');
  program.option('--quiet', 'Suppress output on mutations');

  return program;
}

export async function runCli(argv: string[]): Promise<void> {
  const program = createProgram();
  await program.parseAsync(argv);
}
