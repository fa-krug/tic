import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  slugify,
  isGitRepo,
  branchExists,
  createBranch,
  checkoutBranch,
  hasUncommittedChanges,
  createWorktree,
  worktreeExists,
} from './git.js';

describe('slugify', () => {
  it('converts title to lowercase kebab-case with id prefix', () => {
    expect(slugify('42', 'Add User Authentication')).toBe(
      '42-add-user-authentication',
    );
  });

  it('strips special characters', () => {
    expect(slugify('7', "Fix bug: can't login!")).toBe('7-fix-bug-cant-login');
  });

  it('collapses multiple hyphens', () => {
    expect(slugify('3', 'foo---bar   baz')).toBe('3-foo-bar-baz');
  });

  it('trims trailing hyphens', () => {
    expect(slugify('5', 'trailing hyphens ---')).toBe('5-trailing-hyphens');
  });

  it('truncates very long titles to 80 chars max', () => {
    const longTitle =
      'this is a very long title that should be truncated to eighty characters total including the id prefix';
    const result = slugify('1', longTitle);
    expect(result.length).toBeLessThanOrEqual(80);
    expect(result.endsWith('-')).toBe(false);
  });

  it('handles empty title', () => {
    expect(slugify('10', '')).toBe('10');
  });

  it('handles title with only special characters', () => {
    expect(slugify('99', '!!@@##$$')).toBe('99');
  });
});

describe('isGitRepo', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-git-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns false for non-git directory', () => {
    expect(isGitRepo(tmpDir)).toBe(false);
  });

  it('returns true when .git directory exists', () => {
    execFileSync('git', ['init'], { cwd: tmpDir });
    expect(isGitRepo(tmpDir)).toBe(true);
  });

  it('returns true when .git file exists (worktree)', () => {
    // Simulate a worktree .git file
    fs.writeFileSync(
      path.join(tmpDir, '.git'),
      'gitdir: /some/path/.git/worktrees/branch',
    );
    expect(isGitRepo(tmpDir)).toBe(true);
  });
});

describe('git operations', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-git-test-'));
    execFileSync('git', ['init'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], {
      cwd: tmpDir,
    });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir });
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'init');
    execFileSync('git', ['add', '.'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: tmpDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('branchExists', () => {
    it('returns true for an existing branch', () => {
      expect(branchExists('main', tmpDir) || branchExists('master', tmpDir)).toBe(true);
    });

    it('returns false for a non-existing branch', () => {
      expect(branchExists('nonexistent-branch', tmpDir)).toBe(false);
    });

    it('detects a newly created branch', () => {
      execFileSync('git', ['branch', 'feature-test'], { cwd: tmpDir });
      expect(branchExists('feature-test', tmpDir)).toBe(true);
    });
  });

  describe('createBranch', () => {
    it('creates a new branch', () => {
      createBranch('new-feature', tmpDir);
      expect(branchExists('new-feature', tmpDir)).toBe(true);
    });

    it('throws when branch already exists', () => {
      createBranch('duplicate', tmpDir);
      expect(() => createBranch('duplicate', tmpDir)).toThrow();
    });
  });

  describe('checkoutBranch', () => {
    it('checks out an existing branch', () => {
      createBranch('feature-checkout', tmpDir);
      checkoutBranch('feature-checkout', tmpDir);
      const head = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: tmpDir,
        encoding: 'utf-8',
      }).trim();
      expect(head).toBe('feature-checkout');
    });

    it('throws when branch does not exist', () => {
      expect(() => checkoutBranch('nonexistent', tmpDir)).toThrow();
    });
  });

  describe('hasUncommittedChanges', () => {
    it('returns false for clean working directory', () => {
      expect(hasUncommittedChanges(tmpDir)).toBe(false);
    });

    it('returns true for untracked files', () => {
      fs.writeFileSync(path.join(tmpDir, 'new-file.txt'), 'content');
      expect(hasUncommittedChanges(tmpDir)).toBe(true);
    });

    it('returns true for modified files', () => {
      fs.writeFileSync(path.join(tmpDir, 'README.md'), 'modified');
      expect(hasUncommittedChanges(tmpDir)).toBe(true);
    });

    it('returns true for staged files', () => {
      fs.writeFileSync(path.join(tmpDir, 'README.md'), 'staged');
      execFileSync('git', ['add', 'README.md'], { cwd: tmpDir });
      expect(hasUncommittedChanges(tmpDir)).toBe(true);
    });
  });

  describe('createWorktree', () => {
    it('creates worktree with a new branch', () => {
      const worktreePath = path.join(tmpDir, 'worktree-new');
      createWorktree(worktreePath, 'wt-branch', tmpDir);
      expect(fs.existsSync(worktreePath)).toBe(true);
      expect(fs.existsSync(path.join(worktreePath, '.git'))).toBe(true);
      // .git in a worktree is a file, not a directory
      const stat = fs.statSync(path.join(worktreePath, '.git'));
      expect(stat.isFile()).toBe(true);
      expect(branchExists('wt-branch', tmpDir)).toBe(true);
    });

    it('creates worktree with an existing branch', () => {
      createBranch('existing-branch', tmpDir);
      const worktreePath = path.join(tmpDir, 'worktree-existing');
      createWorktree(worktreePath, 'existing-branch', tmpDir);
      expect(fs.existsSync(worktreePath)).toBe(true);
      // Verify the worktree is on the correct branch
      const head = execFileSync(
        'git',
        ['rev-parse', '--abbrev-ref', 'HEAD'],
        { cwd: worktreePath, encoding: 'utf-8' },
      ).trim();
      expect(head).toBe('existing-branch');
    });
  });

  describe('worktreeExists', () => {
    it('returns false for non-existing path', () => {
      expect(worktreeExists(path.join(tmpDir, 'no-such-worktree'))).toBe(
        false,
      );
    });

    it('returns false for a regular directory', () => {
      const dir = path.join(tmpDir, 'regular-dir');
      fs.mkdirSync(dir);
      expect(worktreeExists(dir)).toBe(false);
    });

    it('returns true for an actual worktree', () => {
      const worktreePath = path.join(tmpDir, 'wt-exists');
      createWorktree(worktreePath, 'wt-exists-branch', tmpDir);
      expect(worktreeExists(worktreePath)).toBe(true);
    });
  });
});
