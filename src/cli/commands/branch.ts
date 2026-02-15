import {
  listBranches,
  listWorktrees,
  createBranch,
  checkoutBranch,
  getCurrentBranch,
  hasUncommittedChanges,
} from '../../git.js';
import {
  deleteBranch,
  mergeBranch,
  removeWorktree,
  pushBranch,
} from '../../git-async.js';
import { linkBranchToItem } from '../../branch-links.js';
import type { WorkItem } from '../../types.js';

export interface BranchListResult {
  name: string;
  current: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  lastCommitDate: string;
  linkedItemId: string | null;
  worktreePath: string | null;
}

export function runBranchList(
  cwd: string,
  items: WorkItem[],
): BranchListResult[] {
  const branches = listBranches(cwd);
  const worktrees = listWorktrees(cwd);

  return branches.map((b) => {
    const linked = linkBranchToItem(b.name, items);
    const wt = worktrees.find((w) => w.branch === b.name);
    return {
      ...b,
      linkedItemId: linked?.id ?? null,
      worktreePath: wt?.path ?? null,
    };
  });
}

export function runBranchSwitch(
  name: string,
  cwd: string,
): { switched: true; branch: string } {
  if (hasUncommittedChanges(cwd)) {
    throw new Error('Uncommitted changes — stash or commit first');
  }
  checkoutBranch(name, cwd);
  return { switched: true, branch: name };
}

export function runBranchCreate(
  name: string,
  cwd: string,
): { created: true; branch: string } {
  createBranch(name, cwd);
  return { created: true, branch: name };
}

export async function runBranchDelete(
  name: string,
  cwd: string,
  force: boolean,
): Promise<{ deleted: true; branch: string }> {
  const current = getCurrentBranch(cwd);
  if (name === current) {
    throw new Error('Cannot delete current branch');
  }
  // Check for worktree and remove if exists
  const worktrees = listWorktrees(cwd);
  const wt = worktrees.find((w) => w.branch === name);
  if (wt) {
    await removeWorktree(wt.path, cwd, true);
  }
  await deleteBranch(name, cwd, force);
  return { deleted: true, branch: name };
}

export async function runBranchMerge(
  name: string,
  cwd: string,
): Promise<{ merged: boolean; message: string; hasConflicts: boolean }> {
  const result = await mergeBranch(name, cwd);
  if (!result.success) {
    throw new Error(result.message);
  }
  return {
    merged: result.success,
    message: result.message,
    hasConflicts: result.hasConflicts,
  };
}

export async function runBranchPush(
  name: string | undefined,
  cwd: string,
): Promise<{ pushed: true; branch: string }> {
  const branch = name ?? getCurrentBranch(cwd);
  if (!branch) {
    throw new Error('Not on a branch (detached HEAD)');
  }
  await pushBranch(branch, cwd);
  return { pushed: true, branch };
}
