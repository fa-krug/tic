import { describe, it, expect } from 'vitest';
import { mapIssueToWorkItem, mapCommentToComment } from './mappers.js';

describe('mapIssueToWorkItem', () => {
  it('maps a full GitHub issue to a WorkItem', () => {
    const ghIssue = {
      number: 42,
      title: 'Fix login bug',
      body: 'The login form breaks on mobile.',
      state: 'OPEN',
      assignees: { nodes: [{ login: 'alice' }, { login: 'bob' }] },
      labels: { nodes: [{ name: 'bug' }, { name: 'urgent' }] },
      milestone: { title: 'v1.0' },
      createdAt: '2026-01-15T10:00:00Z',
      updatedAt: '2026-01-20T14:30:00Z',
      comments: {
        nodes: [
          {
            author: { login: 'charlie' },
            createdAt: '2026-01-16T09:00:00Z',
            body: 'I can reproduce this.',
          },
        ],
      },
      parent: null,
    };

    const item = mapIssueToWorkItem(ghIssue);

    expect(item.id).toBe('42');
    expect(item.title).toBe('Fix login bug');
    expect(item.description).toBe('The login form breaks on mobile.');
    expect(item.status).toBe('open');
    expect(item.type).toBe('issue');
    expect(item.assignee).toBe('alice');
    expect(item.labels).toEqual(['bug', 'urgent']);
    expect(item.iteration).toBe('v1.0');
    expect(item.priority).toBe('medium');
    expect(item.created).toBe('2026-01-15T10:00:00Z');
    expect(item.updated).toBe('2026-01-20T14:30:00Z');
    expect(item.parent).toBeNull();
    expect(item.dependsOn).toEqual([]);
    expect(item.comments).toHaveLength(1);
    expect(item.comments[0]!.author).toBe('charlie');
  });

  it('handles null body', () => {
    const ghIssue = {
      number: 1,
      title: 'Empty',
      body: null,
      state: 'CLOSED',
      assignees: { nodes: [] },
      labels: { nodes: [] },
      milestone: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      comments: { nodes: [] },
      parent: null,
    };

    const item = mapIssueToWorkItem(ghIssue);

    expect(item.description).toBe('');
    expect(item.status).toBe('closed');
    expect(item.assignee).toBe('');
    expect(item.iteration).toBe('');
    expect(item.labels).toEqual([]);
    expect(item.comments).toEqual([]);
  });

  it('handles missing comments array', () => {
    const ghIssue = {
      number: 1,
      title: 'No comments',
      body: 'Test',
      state: 'OPEN',
      assignees: { nodes: [] },
      labels: { nodes: [] },
      milestone: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      comments: { nodes: [] },
      parent: null,
    };

    const item = mapIssueToWorkItem(ghIssue);
    expect(item.comments).toEqual([]);
  });
});

describe('mapCommentToComment', () => {
  it('maps a GitHub comment to a tic Comment', () => {
    const ghComment = {
      author: { login: 'alice' },
      createdAt: '2026-01-15T10:00:00Z',
      body: 'Looks good!',
    };

    const comment = mapCommentToComment(ghComment);

    expect(comment.author).toBe('alice');
    expect(comment.date).toBe('2026-01-15T10:00:00Z');
    expect(comment.body).toBe('Looks good!');
  });
});
