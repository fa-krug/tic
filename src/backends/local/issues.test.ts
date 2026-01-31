import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readIssue, writeIssue, deleteIssue, listIssueFiles, parseIssueFile } from './issues.js';
import type { Issue } from '../../types.js';

describe('issues', () => {
  let tmpDir: string;
  let issuesDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-test-'));
    issuesDir = path.join(tmpDir, '.tic', 'issues');
    fs.mkdirSync(issuesDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('writes and reads an issue', () => {
    const issue: Issue = {
      id: 1, title: 'Test issue', status: 'todo', iteration: 'v1',
      priority: 'high', assignee: 'dev', labels: ['bug'],
      created: '2026-01-31T00:00:00Z', updated: '2026-01-31T00:00:00Z',
      description: 'A test issue.', comments: [],
    };
    writeIssue(tmpDir, issue);
    const read = readIssue(tmpDir, 1);
    expect(read.title).toBe('Test issue');
    expect(read.labels).toEqual(['bug']);
    expect(read.description).toBe('A test issue.');
  });

  it('writes and reads an issue with comments', () => {
    const issue: Issue = {
      id: 2, title: 'With comments', status: 'todo', iteration: 'v1',
      priority: 'medium', assignee: '', labels: [],
      created: '2026-01-31T00:00:00Z', updated: '2026-01-31T00:00:00Z',
      description: 'Has comments.',
      comments: [
        { author: 'dev', date: '2026-01-31T01:00:00Z', body: 'First comment.' },
        { author: 'dev', date: '2026-01-31T02:00:00Z', body: 'Second comment.' },
      ],
    };
    writeIssue(tmpDir, issue);
    const read = readIssue(tmpDir, 2);
    expect(read.comments).toHaveLength(2);
    expect(read.comments[0].body).toBe('First comment.');
  });

  it('deletes an issue file', () => {
    const issue: Issue = {
      id: 3, title: 'To delete', status: 'todo', iteration: 'v1',
      priority: 'low', assignee: '', labels: [],
      created: '2026-01-31T00:00:00Z', updated: '2026-01-31T00:00:00Z',
      description: '', comments: [],
    };
    writeIssue(tmpDir, issue);
    expect(fs.existsSync(path.join(issuesDir, '3.md'))).toBe(true);
    deleteIssue(tmpDir, 3);
    expect(fs.existsSync(path.join(issuesDir, '3.md'))).toBe(false);
  });

  it('lists all issue files', () => {
    writeIssue(tmpDir, { id: 1, title: 'A', status: 'todo', iteration: 'v1', priority: 'low', assignee: '', labels: [], created: '', updated: '', description: '', comments: [] });
    writeIssue(tmpDir, { id: 2, title: 'B', status: 'todo', iteration: 'v1', priority: 'low', assignee: '', labels: [], created: '', updated: '', description: '', comments: [] });
    const files = listIssueFiles(tmpDir);
    expect(files).toHaveLength(2);
  });
});
