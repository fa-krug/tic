import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import os from 'node:os';
import { deleteBranch, mergeBranch, removeWorktree } from './git-async.js';

function initRepo(dir: string) {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], {
    cwd: dir,
    stdio: 'pipe',
  });
  execFileSync('git', ['config', 'user.name', 'Test'], {
    cwd: dir,
    stdio: 'pipe',
  });
  writeFileSync(join(dir, 'file.txt'), 'hello');
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'initial'], {
    cwd: dir,
    stdio: 'pipe',
  });
}

describe('deleteBranch', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(os.tmpdir(), 'tic-git-async-'));
    initRepo(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('deletes a merged branch', async () => {
    execFileSync('git', ['branch', 'to-delete'], { cwd: dir, stdio: 'pipe' });
    await deleteBranch('to-delete', dir);
    const output = execFileSync('git', ['branch', '--list', 'to-delete'], {
      cwd: dir,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    expect(output.trim()).toBe('');
  });

  it('throws when deleting unmerged branch without force', async () => {
    execFileSync('git', ['checkout', '-b', 'unmerged'], {
      cwd: dir,
      stdio: 'pipe',
    });
    writeFileSync(join(dir, 'new.txt'), 'new');
    execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'unmerged work'], {
      cwd: dir,
      stdio: 'pipe',
    });
    execFileSync('git', ['checkout', '-'], { cwd: dir, stdio: 'pipe' });
    await expect(deleteBranch('unmerged', dir)).rejects.toThrow();
  });

  it('force-deletes unmerged branch', async () => {
    execFileSync('git', ['checkout', '-b', 'unmerged'], {
      cwd: dir,
      stdio: 'pipe',
    });
    writeFileSync(join(dir, 'new.txt'), 'new');
    execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'unmerged work'], {
      cwd: dir,
      stdio: 'pipe',
    });
    execFileSync('git', ['checkout', '-'], { cwd: dir, stdio: 'pipe' });
    await deleteBranch('unmerged', dir, true);
    const output = execFileSync('git', ['branch', '--list', 'unmerged'], {
      cwd: dir,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    expect(output.trim()).toBe('');
  });
});

describe('mergeBranch', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(os.tmpdir(), 'tic-git-async-'));
    initRepo(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('merges a branch into current', async () => {
    execFileSync('git', ['checkout', '-b', 'feature'], {
      cwd: dir,
      stdio: 'pipe',
    });
    writeFileSync(join(dir, 'feature.txt'), 'feature');
    execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'feature work'], {
      cwd: dir,
      stdio: 'pipe',
    });
    execFileSync('git', ['checkout', '-'], { cwd: dir, stdio: 'pipe' });

    const result = await mergeBranch('feature', dir);
    expect(result.success).toBe(true);
  });
});

describe('removeWorktree', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(os.tmpdir(), 'tic-git-async-'));
    initRepo(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('removes a worktree', async () => {
    execFileSync('git', ['branch', 'wt-branch'], { cwd: dir, stdio: 'pipe' });
    const wtPath = join(dir, '.worktrees', 'wt-branch');
    execFileSync('git', ['worktree', 'add', wtPath, 'wt-branch'], {
      cwd: dir,
      stdio: 'pipe',
    });
    await removeWorktree(wtPath, dir);
    const output = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: dir,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    expect(output).not.toContain('wt-branch');
  });
});
