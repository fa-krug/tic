import { describe, it, expect } from 'vitest';
import { mapWorkItemToWorkItem, mapNoteToComment } from './mappers.js';
import type { GlWorkItem, GlNote } from './mappers.js';

function makeGlWorkItem(overrides: Partial<GlWorkItem> = {}): GlWorkItem {
  return {
    id: 'gid://gitlab/WorkItem/100',
    iid: '42',
    title: 'Fix login bug',
    state: 'OPEN',
    workItemType: { name: 'Issue' },
    widgets: [],
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-01-20T14:30:00Z',
    ...overrides,
  };
}

describe('mapWorkItemToWorkItem', () => {
  it('maps a full GitLab work item (issue) to a WorkItem', () => {
    const gl = makeGlWorkItem({
      widgets: [
        {
          __typename: 'WorkItemWidgetDescription',
          description: 'The login form breaks on mobile.',
        },
        {
          __typename: 'WorkItemWidgetAssignees',
          assignees: {
            nodes: [{ username: 'alice' }, { username: 'bob' }],
          },
        },
        {
          __typename: 'WorkItemWidgetLabels',
          labels: { nodes: [{ title: 'bug' }, { title: 'urgent' }] },
        },
        {
          __typename: 'WorkItemWidgetMilestone',
          milestone: { title: 'v1.0' },
        },
        {
          __typename: 'WorkItemWidgetHierarchy',
          parent: {
            id: 'gid://gitlab/WorkItem/50',
            iid: '5',
            workItemType: { name: 'Epic' },
          },
        },
      ],
    });

    const item = mapWorkItemToWorkItem(gl);

    expect(item.rowId).toBe(42);
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
    expect(item.parent).toBe(5);
    expect(item.dependsOn).toEqual([]);
    expect(item.comments).toEqual([]);
  });

  it('handles empty widgets (no description, assignees, labels, etc.)', () => {
    const gl = makeGlWorkItem({
      iid: '1',
      state: 'CLOSED',
      widgets: [],
    });

    const item = mapWorkItemToWorkItem(gl);

    expect(item.description).toBe('');
    expect(item.status).toBe('closed');
    expect(item.assignee).toBe('');
    expect(item.iteration).toBe('');
    expect(item.parent).toBeNull();
    expect(item.labels).toEqual([]);
  });

  it('maps OPEN state to open', () => {
    const gl = makeGlWorkItem({ state: 'OPEN' });
    expect(mapWorkItemToWorkItem(gl).status).toBe('open');
  });

  it('maps CLOSED state to closed', () => {
    const gl = makeGlWorkItem({ state: 'CLOSED' });
    expect(mapWorkItemToWorkItem(gl).status).toBe('closed');
  });

  it('sets parent from hierarchy widget', () => {
    const gl = makeGlWorkItem({
      widgets: [
        {
          __typename: 'WorkItemWidgetHierarchy',
          parent: {
            id: 'gid://gitlab/WorkItem/70',
            iid: '7',
            workItemType: { name: 'Epic' },
          },
        },
      ],
    });

    expect(mapWorkItemToWorkItem(gl).parent).toBe(7);
  });

  it('handles null milestone', () => {
    const gl = makeGlWorkItem({
      widgets: [
        {
          __typename: 'WorkItemWidgetMilestone',
          milestone: null,
        },
      ],
    });

    expect(mapWorkItemToWorkItem(gl).iteration).toBe('');
  });

  it('maps Epic work item type to epic', () => {
    const gl = makeGlWorkItem({
      iid: '5',
      workItemType: { name: 'Epic' },
      widgets: [],
    });

    const item = mapWorkItemToWorkItem(gl);
    expect(item.id).toBe('epic-5');
    expect(item.type).toBe('epic');
  });

  it('extracts comments from notes widget', () => {
    const gl = makeGlWorkItem({
      widgets: [
        {
          __typename: 'WorkItemWidgetNotes',
          discussions: {
            nodes: [
              {
                notes: {
                  nodes: [
                    {
                      author: { username: 'charlie' },
                      createdAt: '2026-01-16T09:00:00Z',
                      body: 'I can reproduce this.',
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    });

    const item = mapWorkItemToWorkItem(gl);
    expect(item.comments).toHaveLength(1);
    expect(item.comments[0]!.author).toBe('charlie');
    expect(item.comments[0]!.body).toBe('I can reproduce this.');
  });
});

describe('mapNoteToComment', () => {
  it('maps a GitLab note to a tic Comment', () => {
    const note: GlNote = {
      author: { username: 'alice' },
      createdAt: '2026-01-15T10:00:00Z',
      body: 'Looks good!',
    };

    const comment = mapNoteToComment(note);

    expect(comment.author).toBe('alice');
    expect(comment.date).toBe('2026-01-15T10:00:00Z');
    expect(comment.body).toBe('Looks good!');
  });
});
