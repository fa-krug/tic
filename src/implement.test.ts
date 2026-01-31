import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import type { WorkItem, Comment } from './types.js';
import { formatItemForClipboard, beginImplementation } from './implement.js';
import { branchExists, worktreeExists } from './git.js';

function makeItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: '42',
    title: 'Add user authentication',
    type: 'feature',
    status: 'in-progress',
    iteration: 'v1',
    priority: 'high',
    assignee: 'skrug',
    labels: ['backend', 'security'],
    created: '2026-01-30T10:00:00Z',
    updated: '2026-01-30T12:00:00Z',
    description: 'Users should be able to log in.',
    comments: [],
    parent: null,
    dependsOn: [],
    ...overrides,
  };
}

describe('formatItemForClipboard', () => {
  it('formats a full item with all fields', () => {
    const item = makeItem({
      parent: '10',
      dependsOn: ['38', '41'],
    });
    const comments: Comment[] = [
      { author: 'skrug', date: '2026-01-30', body: 'Use bcrypt.' },
    ];

    const result = formatItemForClipboard(item, comments);

    expect(result).toBe(
      [
        '# #42: Add user authentication',
        '',
        '- **Type:** feature',
        '- **Status:** in-progress',
        '- **Priority:** high',
        '- **Assignee:** skrug',
        '- **Labels:** backend, security',
        '- **Parent:** #10',
        '- **Depends on:** #38, #41',
        '',
        '## Description',
        '',
        'Users should be able to log in.',
        '',
        '## Comments',
        '',
        '**skrug** (2026-01-30):',
        'Use bcrypt.',
      ].join('\n'),
    );
  });

  it('omits priority when not set', () => {
    const item = makeItem({ priority: '' as WorkItem['priority'] });
    const result = formatItemForClipboard(item, []);
    expect(result).not.toContain('Priority');
  });

  it('omits assignee when empty', () => {
    const item = makeItem({ assignee: '' });
    const result = formatItemForClipboard(item, []);
    expect(result).not.toContain('Assignee');
  });

  it('omits labels when empty array', () => {
    const item = makeItem({ labels: [] });
    const result = formatItemForClipboard(item, []);
    expect(result).not.toContain('Labels');
  });

  it('omits parent when null', () => {
    const item = makeItem({ parent: null });
    const result = formatItemForClipboard(item, []);
    expect(result).not.toContain('Parent');
  });

  it('omits depends on when empty array', () => {
    const item = makeItem({ dependsOn: [] });
    const result = formatItemForClipboard(item, []);
    expect(result).not.toContain('Depends on');
  });

  it('omits comments section when no comments', () => {
    const item = makeItem();
    const result = formatItemForClipboard(item, []);
    expect(result).not.toContain('## Comments');
  });

  it('includes multiple comments', () => {
    const item = makeItem();
    const comments: Comment[] = [
      { author: 'alice', date: '2026-01-28', body: 'First comment.' },
      { author: 'bob', date: '2026-01-29', body: 'Second comment.' },
    ];

    const result = formatItemForClipboard(item, comments);

    expect(result).toContain('## Comments');
    expect(result).toContain('**alice** (2026-01-28):');
    expect(result).toContain('First comment.');
    expect(result).toContain('**bob** (2026-01-29):');
    expect(result).toContain('Second comment.');
  });

  it('handles minimal item with only required fields', () => {
    const item = makeItem({
      priority: '' as WorkItem['priority'],
      assignee: '',
      labels: [],
      parent: null,
      dependsOn: [],
      description: '',
    });

    const result = formatItemForClipboard(item, []);

    expect(result).toBe(
      [
        '# #42: Add user authentication',
        '',
        '- **Type:** feature',
        '- **Status:** in-progress',
      ].join('\n'),
    );
  });

  it('includes description section when description is present', () => {
    const item = makeItem({ description: 'Some description.' });
    const result = formatItemForClipboard(item, []);
    expect(result).toContain('## Description');
    expect(result).toContain('Some description.');
  });

  it('omits description section when description is empty', () => {
    const item = makeItem({ description: '' });
    const result = formatItemForClipboard(item, []);
    expect(result).not.toContain('## Description');
  });
});

describe('beginImplementation', () => {
  let tmpDir: string;

  function initRepo(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-impl-test-'));
    execFileSync('git', ['init'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], {
      cwd: dir,
    });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'README.md'), 'init');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: dir });
    return dir;
  }

  beforeEach(() => {
    tmpDir = initRepo();
  });

  afterEach(() => {
    // Clean up worktrees first to avoid git lock issues
    try {
      execFileSync('git', ['worktree', 'prune'], { cwd: tmpDir });
    } catch {
      // ignore
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('worktree mode', () => {
    it('creates worktree and branch', () => {
      const item = makeItem();
      const result = beginImplementation(
        item,
        [],
        { branchMode: 'worktree' },
        tmpDir,
        { skipShell: true, skipClipboard: true },
      );

      expect(result.resumed).toBe(false);
      expect(branchExists('tic/42-add-user-authentication', tmpDir)).toBe(true);

      const expectedWorktreePath = path.join(
        tmpDir,
        '.worktrees',
        '42-add-user-authentication',
      );
      expect(result.targetDir).toBe(expectedWorktreePath);
      expect(worktreeExists(expectedWorktreePath)).toBe(true);
    });

    it('resumes when branch already exists', () => {
      const item = makeItem();

      // First call creates the worktree
      beginImplementation(item, [], { branchMode: 'worktree' }, tmpDir, {
        skipShell: true,
        skipClipboard: true,
      });

      // Second call should resume
      const result = beginImplementation(
        item,
        [],
        { branchMode: 'worktree' },
        tmpDir,
        { skipShell: true, skipClipboard: true },
      );

      expect(result.resumed).toBe(true);
      expect(branchExists('tic/42-add-user-authentication', tmpDir)).toBe(true);
    });
  });

  describe('branch mode', () => {
    it('creates and checks out branch', () => {
      const item = makeItem();
      const result = beginImplementation(
        item,
        [],
        { branchMode: 'branch' },
        tmpDir,
        { skipShell: true, skipClipboard: true },
      );

      expect(result.resumed).toBe(false);
      expect(result.targetDir).toBe(tmpDir);
      expect(branchExists('tic/42-add-user-authentication', tmpDir)).toBe(true);

      // Verify we're actually on the new branch
      const head = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: tmpDir,
        encoding: 'utf-8',
      }).trim();
      expect(head).toBe('tic/42-add-user-authentication');
    });

    it('resumes when branch already exists', () => {
      const item = makeItem();

      // First call creates the branch
      beginImplementation(item, [], { branchMode: 'branch' }, tmpDir, {
        skipShell: true,
        skipClipboard: true,
      });

      // Go back to original branch to simulate returning to TUI
      execFileSync('git', ['checkout', '-'], { cwd: tmpDir });

      // Second call should resume
      const result = beginImplementation(
        item,
        [],
        { branchMode: 'branch' },
        tmpDir,
        { skipShell: true, skipClipboard: true },
      );

      expect(result.resumed).toBe(true);

      // Should be on the tic branch now
      const head = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: tmpDir,
        encoding: 'utf-8',
      }).trim();
      expect(head).toBe('tic/42-add-user-authentication');
    });

    it('throws on dirty working directory', () => {
      const item = makeItem();

      // Make the working directory dirty
      fs.writeFileSync(path.join(tmpDir, 'dirty.txt'), 'uncommitted');

      expect(() =>
        beginImplementation(item, [], { branchMode: 'branch' }, tmpDir, {
          skipShell: true,
          skipClipboard: true,
        }),
      ).toThrow(/uncommitted/i);
    });
  });

  it('returns clipboardOk false when clipboard is skipped', () => {
    const item = makeItem();
    const result = beginImplementation(
      item,
      [],
      { branchMode: 'branch' },
      tmpDir,
      { skipShell: true, skipClipboard: true },
    );

    expect(result.clipboardOk).toBe(false);
  });
});
