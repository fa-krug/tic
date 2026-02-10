import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
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
  /** Run branchCommand non-interactively (no interactive shell wrapper). For testing. */
  nonInteractive?: boolean;
  itemUrl?: string;
}

/**
 * Begin implementation of a work item by creating a branch (or worktree),
 * copying item details to clipboard, and spawning a shell.
 */
export function beginImplementation(
  item: WorkItem,
  comments: Comment[],
  config: {
    branchMode: 'worktree' | 'branch';
    branchCommand?: string;
    copyToClipboard?: boolean;
  },
  repoRoot: string,
  options?: ImplementOptions,
): {
  resumed: boolean;
  targetDir: string;
  clipboardOk: boolean;
  commandFailed: boolean;
} {
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
  if (!options?.skipClipboard && config.copyToClipboard !== false) {
    const text = formatItemForClipboard(item, comments);
    clipboardOk = copyToClipboard(text);
  }

  // Spawn shell / run branch command
  let commandFailed = false;
  if (!options?.skipShell) {
    const env = {
      ...process.env,
      TIC_ITEM_ID: item.id,
      TIC_ITEM_TITLE: item.title,
      TIC_ITEM_DESCRIPTION: item.description,
      TIC_ITEM_STATUS: item.status,
      TIC_ITEM_PRIORITY: item.priority || '',
      TIC_ITEM_LABELS: item.labels.join(','),
      TIC_ITEM_URL: options?.itemUrl || '',
      TIC_BRANCH: branch,
      TIC_TARGET_DIR: targetDir,
    };

    const shell = process.env['SHELL'] || '/bin/sh';
    const command = config.branchCommand;

    if (command && options?.nonInteractive) {
      // Non-interactive: just run the command directly (used in tests)
      const result = spawnSync(command, [], {
        cwd: targetDir,
        stdio: 'inherit',
        env,
        shell: '/bin/sh',
      });
      if (result.status !== 0 && result.status !== null) {
        commandFailed = true;
      }
    } else if (command) {
      // Write a temporary rc file that sources the user's profile then runs
      // the configured command. This gives us an interactive shell that
      // executes the branchCommand on startup and stays open.
      const rcFile = path.join(os.tmpdir(), `tic-rc-${process.pid}.sh`);
      const rcContent = [
        `[ -f ~/.bashrc ] && . ~/.bashrc`,
        `[ -f ~/.zshrc ] && . ~/.zshrc`,
        command,
      ].join('\n');
      fs.writeFileSync(rcFile, rcContent);

      const shellName = path.basename(shell);
      let result;
      if (shellName === 'bash') {
        result = spawnSync(shell, ['--init-file', rcFile], {
          cwd: targetDir,
          stdio: 'inherit',
          env,
        });
      } else if (shellName === 'zsh') {
        result = spawnSync(shell, [], {
          cwd: targetDir,
          stdio: 'inherit',
          env: {
            ...env,
            ZDOTDIR_ORIG: process.env['ZDOTDIR'] || '',
            ZDOTDIR: path.dirname(rcFile),
            ENV: rcFile,
          },
        });
      } else {
        // POSIX sh fallback: ENV is sourced by interactive sh
        result = spawnSync(shell, [], {
          cwd: targetDir,
          stdio: 'inherit',
          env: { ...env, ENV: rcFile },
        });
      }

      try {
        fs.unlinkSync(rcFile);
      } catch {
        // ignore cleanup errors
      }

      if (result.status !== 0 && result.status !== null) {
        commandFailed = true;
      }
    } else {
      // No branchCommand: plain interactive shell
      spawnSync(shell, [], { cwd: targetDir, stdio: 'inherit', env });
    }
  }

  return { resumed, targetDir, clipboardOk, commandFailed };
}
