import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Convert an item ID and title into a kebab-case branch slug.
 * Example: slugify('42', 'Add User Authentication') => '42-add-user-authentication'
 * Truncated to max 80 characters total.
 */
export function slugify(id: string, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s-]+/g, '-')
    .replace(/-+$/, '');

  if (!slug) {
    return id;
  }

  const full = `${id}-${slug}`;

  if (full.length <= 80) {
    return full;
  }

  // Truncate and remove any trailing hyphen from the cut
  return full.slice(0, 80).replace(/-+$/, '');
}

/**
 * Check whether `root` is inside a git repository by looking for a .git
 * directory or file (worktrees use a .git file).
 */
export function isGitRepo(root: string): boolean {
  const gitPath = path.join(root, '.git');
  return fs.existsSync(gitPath);
}

/**
 * Check whether a branch exists in the repository.
 */
export function branchExists(name: string, cwd: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--verify', name], {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Create a new branch (without switching to it).
 */
export function createBranch(name: string, cwd: string): void {
  execFileSync('git', ['branch', name], {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/**
 * Check out an existing branch.
 */
export function checkoutBranch(name: string, cwd: string): void {
  execFileSync('git', ['checkout', name], {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

/**
 * Return true if the working directory has uncommitted changes
 * (untracked, modified, or staged files).
 */
export function hasUncommittedChanges(cwd: string): boolean {
  const output = execFileSync('git', ['status', '--porcelain'], {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return output.trim().length > 0;
}

/**
 * Create a git worktree. If the branch already exists, checks it out;
 * otherwise creates a new branch with `-b`.
 */
export function createWorktree(
  worktreePath: string,
  branch: string,
  cwd: string,
): void {
  if (branchExists(branch, cwd)) {
    execFileSync('git', ['worktree', 'add', worktreePath, branch], {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } else {
    execFileSync(
      'git',
      ['worktree', 'add', worktreePath, '-b', branch],
      {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
  }
}

/**
 * Check whether a path is a git worktree (exists and has a .git file,
 * not a .git directory).
 */
export function worktreeExists(worktreePath: string): boolean {
  const gitPath = path.join(worktreePath, '.git');
  try {
    const stat = fs.statSync(gitPath);
    return stat.isFile();
  } catch {
    return false;
  }
}
