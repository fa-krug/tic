import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface MergeResult {
  success: boolean;
  message: string;
  hasConflicts: boolean;
}

export async function deleteBranch(
  name: string,
  cwd: string,
  force = false,
): Promise<void> {
  await execFileAsync('git', ['branch', force ? '-D' : '-d', name], { cwd });
}

export async function mergeBranch(
  name: string,
  cwd: string,
): Promise<MergeResult> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['merge', '--no-edit', name],
      { cwd },
    );
    return { success: true, message: stdout.trim(), hasConflicts: false };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const hasConflicts =
      message.includes('CONFLICT') || message.includes('Merge conflict');
    if (hasConflicts) {
      try {
        await execFileAsync('git', ['merge', '--abort'], { cwd });
      } catch {
        // ignore abort failures
      }
    }
    return { success: false, message, hasConflicts };
  }
}

export async function removeWorktree(
  worktreePath: string,
  cwd: string,
  force = false,
): Promise<void> {
  const args = ['worktree', 'remove'];
  if (force) args.push('--force');
  args.push(worktreePath);
  await execFileAsync('git', args, { cwd });
}

export async function fetchAll(cwd: string): Promise<void> {
  await execFileAsync('git', ['fetch', '--all', '--prune'], { cwd });
}

export async function pushBranch(name: string, cwd: string): Promise<void> {
  await execFileAsync('git', ['push', '-u', 'origin', name], { cwd });
}
