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
 * Return the name of the currently checked-out branch, or null if detached HEAD.
 */
export function getCurrentBranch(cwd: string): string | null {
  try {
    const output = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return output.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Check whether a branch exists in the repository.
 */
export function branchExists(name: string, cwd: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--verify', `refs/heads/${name}`], {
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
    execFileSync('git', ['worktree', 'add', worktreePath, '-b', branch], {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
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

export interface BranchInfo {
  name: string;
  current: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  lastCommitDate: string;
}

export interface WorktreeInfo {
  path: string;
  branch: string | null;
  head: string;
  bare: boolean;
}

export function listBranches(cwd: string): BranchInfo[] {
  const format =
    '%(HEAD)%00%(refname:short)%00%(upstream:short)%00%(upstream:track)%00%(committerdate:iso-strict)';
  const output = execFileSync(
    'git',
    ['for-each-ref', '--format', format, 'refs/heads/'],
    { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
  );

  return output
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const [head, name, upstream, track, date] = line.split('\0');
      const aheadMatch = track?.match(/ahead (\d+)/);
      const behindMatch = track?.match(/behind (\d+)/);
      return {
        name: name!,
        current: head === '*',
        upstream: upstream || null,
        ahead: aheadMatch ? parseInt(aheadMatch[1]!, 10) : 0,
        behind: behindMatch ? parseInt(behindMatch[1]!, 10) : 0,
        lastCommitDate: date ?? '',
      };
    });
}

export function listWorktrees(cwd: string): WorktreeInfo[] {
  const output = execFileSync('git', ['worktree', 'list', '--porcelain'], {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const worktrees: WorktreeInfo[] = [];
  let current: Partial<WorktreeInfo> = {};

  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      current.path = line.slice('worktree '.length);
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length);
    } else if (line.startsWith('branch ')) {
      const ref = line.slice('branch '.length);
      current.branch = ref.replace('refs/heads/', '');
    } else if (line === 'bare') {
      current.bare = true;
    } else if (line === 'detached') {
      current.branch = null;
    } else if (line === '') {
      if (current.path) {
        worktrees.push({
          path: current.path,
          branch: current.branch ?? null,
          head: current.head ?? '',
          bare: current.bare ?? false,
        });
      }
      current = {};
    }
  }
  return worktrees;
}
