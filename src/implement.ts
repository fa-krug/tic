import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import type { WorkItem, Comment } from './types.js';
import {
  slugify,
  branchExists,
  createBranch,
  checkoutBranch,
  createWorktree,
  worktreeExists,
  hasUncommittedChanges,
} from './git.js';

/**
 * Format a work item and its comments as markdown suitable for clipboard.
 */
export function formatItemForClipboard(
  item: WorkItem,
  comments: Comment[],
): string {
  const lines: string[] = [];

  // Title
  lines.push(`# #${item.id}: ${item.title}`);
  lines.push('');

  // Metadata - always include type and status
  lines.push(`- **Type:** ${item.type}`);
  lines.push(`- **Status:** ${item.status}`);

  if (item.priority) {
    lines.push(`- **Priority:** ${item.priority}`);
  }

  if (item.assignee) {
    lines.push(`- **Assignee:** ${item.assignee}`);
  }

  if (item.labels.length > 0) {
    lines.push(`- **Labels:** ${item.labels.join(', ')}`);
  }

  if (item.parent !== null) {
    lines.push(`- **Parent:** #${item.parent}`);
  }

  if (item.dependsOn.length > 0) {
    lines.push(
      `- **Depends on:** ${item.dependsOn.map((d) => `#${d}`).join(', ')}`,
    );
  }

  // Description
  if (item.description) {
    lines.push('');
    lines.push('## Description');
    lines.push('');
    lines.push(item.description);
  }

  // Comments
  if (comments.length > 0) {
    lines.push('');
    lines.push('## Comments');

    for (const comment of comments) {
      lines.push('');
      lines.push(`**${comment.author}** (${comment.date}):`);
      lines.push(comment.body);
    }
  }

  return lines.join('\n');
}

/**
 * Copy text to the system clipboard.
 * Returns true on success, false on failure (non-fatal).
 */
export function copyToClipboard(text: string): boolean {
  try {
    if (process.platform === 'darwin') {
      execFileSync('pbcopy', [], {
        input: text,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return true;
    }

    // Linux: try xclip first, then xsel
    try {
      execFileSync('xclip', ['-selection', 'clipboard'], {
        input: text,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return true;
    } catch {
      execFileSync('xsel', ['--clipboard'], {
        input: text,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return true;
    }
  } catch {
    return false;
  }
}

export interface ImplementOptions {
  skipShell?: boolean;
  skipClipboard?: boolean;
}

/**
 * Begin implementation of a work item by creating a branch (or worktree),
 * copying item details to clipboard, and spawning a shell.
 */
export function beginImplementation(
  item: WorkItem,
  comments: Comment[],
  config: { branchMode: 'worktree' | 'branch' },
  repoRoot: string,
  options?: ImplementOptions,
): { resumed: boolean; targetDir: string; clipboardOk: boolean } {
  const slug = slugify(item.id, item.title);
  const branch = `tic/${slug}`;
  const resumed = branchExists(branch, repoRoot);

  let targetDir: string;

  if (config.branchMode === 'worktree') {
    const worktreePath = path.join(repoRoot, '.worktrees', slug);
    targetDir = worktreePath;

    if (!worktreeExists(worktreePath)) {
      createWorktree(worktreePath, branch, repoRoot);
    }
  } else {
    // branch mode
    targetDir = repoRoot;

    if (!resumed) {
      if (hasUncommittedChanges(repoRoot)) {
        throw new Error(
          'Uncommitted changes in working directory. Please commit or stash before switching branches.',
        );
      }
      createBranch(branch, repoRoot);
    }

    checkoutBranch(branch, repoRoot);
  }

  // Copy to clipboard
  let clipboardOk = false;
  if (!options?.skipClipboard) {
    const text = formatItemForClipboard(item, comments);
    clipboardOk = copyToClipboard(text);
  }

  // Spawn shell
  if (!options?.skipShell) {
    const shell = process.env.SHELL || '/bin/sh';
    spawnSync(shell, [], {
      cwd: targetDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        TIC_ITEM_ID: item.id,
        TIC_ITEM_TITLE: item.title,
      },
    });
  }

  return { resumed, targetDir, clipboardOk };
}
