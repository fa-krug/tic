import { describe, it, expect } from 'vitest';
import {
  mapIssueToWorkItem,
  mapEpicToWorkItem,
  mapNoteToComment,
} from './mappers.js';

describe('mapIssueToWorkItem', () => {
  it('maps a full GitLab issue to a WorkItem', () => {
    const glIssue = {
      iid: 42,
      title: 'Fix login bug',
      description: 'The login form breaks on mobile.',
      state: 'opened',
      assignees: [{ username: 'alice' }, { username: 'bob' }],
      labels: ['bug', 'urgent'],
      milestone: { title: 'v1.0' },
      epic: { iid: 5 },
      created_at: '2026-01-15T10:00:00Z',
      updated_at: '2026-01-20T14:30:00Z',
    };

    const item = mapIssueToWorkItem(glIssue);

    expect(item.id).toBe('issue-42');
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
    expect(item.parent).toBe('epic-5');
    expect(item.dependsOn).toEqual([]);
    expect(item.comments).toEqual([]);
  });

  it('handles null description', () => {
    const glIssue = {
      iid: 1,
      title: 'Empty',
      description: null,
      state: 'closed',
      assignees: [],
      labels: [],
      milestone: null,
      epic: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    const item = mapIssueToWorkItem(glIssue);

    expect(item.description).toBe('');
    expect(item.status).toBe('closed');
    expect(item.assignee).toBe('');
    expect(item.iteration).toBe('');
    expect(item.parent).toBeNull();
  });

  it('maps opened state to open', () => {
    const glIssue = {
      iid: 3,
      title: 'Open issue',
      description: '',
      state: 'opened',
      assignees: [],
      labels: [],
      milestone: null,
      epic: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    expect(mapIssueToWorkItem(glIssue).status).toBe('open');
  });

  it('maps closed state to closed', () => {
    const glIssue = {
      iid: 4,
      title: 'Closed issue',
      description: '',
      state: 'closed',
      assignees: [],
      labels: [],
      milestone: null,
      epic: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    expect(mapIssueToWorkItem(glIssue).status).toBe('closed');
  });

  it('sets parent from epic iid', () => {
    const glIssue = {
      iid: 10,
      title: 'With epic',
      description: '',
      state: 'opened',
      assignees: [],
      labels: [],
      milestone: null,
      epic: { iid: 7 },
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    expect(mapIssueToWorkItem(glIssue).parent).toBe('epic-7');
  });
});

describe('mapEpicToWorkItem', () => {
  it('maps a full GitLab epic to a WorkItem', () => {
    const glEpic = {
      iid: 5,
      title: 'Big feature',
      description: 'Epic description here.',
      state: 'opened',
      labels: ['feature', 'priority'],
      created_at: '2026-01-10T00:00:00Z',
      updated_at: '2026-01-18T00:00:00Z',
    };

    const item = mapEpicToWorkItem(glEpic);

    expect(item.id).toBe('epic-5');
    expect(item.title).toBe('Big feature');
    expect(item.description).toBe('Epic description here.');
    expect(item.status).toBe('open');
    expect(item.type).toBe('epic');
    expect(item.assignee).toBe('');
    expect(item.labels).toEqual(['feature', 'priority']);
    expect(item.iteration).toBe('');
    expect(item.priority).toBe('medium');
    expect(item.parent).toBeNull();
    expect(item.dependsOn).toEqual([]);
    expect(item.comments).toEqual([]);
  });

  it('handles null description', () => {
    const glEpic = {
      iid: 1,
      title: 'Empty epic',
      description: null,
      state: 'closed',
      labels: [],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    const item = mapEpicToWorkItem(glEpic);

    expect(item.description).toBe('');
    expect(item.status).toBe('closed');
  });

  it('maps opened state to open', () => {
    const glEpic = {
      iid: 2,
      title: 'Open epic',
      description: '',
      state: 'opened',
      labels: [],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    expect(mapEpicToWorkItem(glEpic).status).toBe('open');
  });
});

describe('mapNoteToComment', () => {
  it('maps a GitLab note to a tic Comment', () => {
    const glNote = {
      author: { username: 'alice' },
      created_at: '2026-01-15T10:00:00Z',
      body: 'Looks good!',
    };

    const comment = mapNoteToComment(glNote);

    expect(comment.author).toBe('alice');
    expect(comment.date).toBe('2026-01-15T10:00:00Z');
    expect(comment.body).toBe('Looks good!');
  });
});
