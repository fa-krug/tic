import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LocalBackend } from './index.js';

describe('LocalBackend', () => {
  let tmpDir: string;
  let backend: LocalBackend;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-test-'));
    backend = new LocalBackend(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns default statuses', () => {
    expect(backend.getStatuses()).toEqual(['backlog', 'todo', 'in-progress', 'review', 'done']);
  });

  it('creates and lists issues', () => {
    backend.createIssue({
      title: 'Test', status: 'todo', iteration: 'default',
      priority: 'medium', assignee: '', labels: [], description: 'A test.',
    });
    const issues = backend.listIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0].title).toBe('Test');
    expect(issues[0].id).toBe(1);
  });

  it('filters issues by iteration', () => {
    backend.createIssue({ title: 'A', status: 'todo', iteration: 'v1', priority: 'low', assignee: '', labels: [], description: '' });
    backend.createIssue({ title: 'B', status: 'todo', iteration: 'v2', priority: 'low', assignee: '', labels: [], description: '' });
    expect(backend.listIssues('v1')).toHaveLength(1);
    expect(backend.listIssues('v2')).toHaveLength(1);
  });

  it('updates an issue', () => {
    backend.createIssue({ title: 'Original', status: 'todo', iteration: 'default', priority: 'low', assignee: '', labels: [], description: '' });
    backend.updateIssue(1, { title: 'Updated', status: 'in-progress' });
    const issue = backend.getIssue(1);
    expect(issue.title).toBe('Updated');
    expect(issue.status).toBe('in-progress');
  });

  it('deletes an issue', () => {
    backend.createIssue({ title: 'Delete me', status: 'todo', iteration: 'default', priority: 'low', assignee: '', labels: [], description: '' });
    expect(backend.listIssues()).toHaveLength(1);
    backend.deleteIssue(1);
    expect(backend.listIssues()).toHaveLength(0);
  });

  it('adds a comment', () => {
    backend.createIssue({ title: 'Commentable', status: 'todo', iteration: 'default', priority: 'low', assignee: '', labels: [], description: '' });
    backend.addComment(1, { author: 'dev', body: 'A comment.' });
    const issue = backend.getIssue(1);
    expect(issue.comments).toHaveLength(1);
    expect(issue.comments[0].body).toBe('A comment.');
  });

  it('manages iterations', () => {
    expect(backend.getCurrentIteration()).toBe('default');
    backend.setCurrentIteration('v1');
    expect(backend.getCurrentIteration()).toBe('v1');
    expect(backend.getIterations()).toContain('v1');
  });
});
