import { describe, it, expect } from 'vitest';
import type { GlWorkItem, GlNote } from './mappers.js';
import { mapWorkItemToWorkItem, mapNoteToComment } from './mappers.js';

function makeWorkItem(overrides: Partial<GlWorkItem> = {}): GlWorkItem {
  return {
    id: 'gid://gitlab/WorkItem/42',
    iid: '42',
    title: 'Test item',
    state: 'OPEN',
    workItemType: { name: 'Issue' },
    widgets: [],
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-01-20T14:30:00Z',
    ...overrides,
  };
}

describe('mapWorkItemToWorkItem', () => {
  it('maps an issue with all widgets populated', () => {
    const glWorkItem = makeWorkItem({
      iid: '42',
      title: 'Fix login bug',
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
            id: 'gid://gitlab/WorkItem/5',
            iid: '5',
            workItemType: { name: 'Epic' },
          },
        },
        {
          __typename: 'WorkItemWidgetNotes',
          discussions: {
            nodes: [
              {
                notes: {
                  nodes: [
                    {
                      author: { username: 'carol' },
                      createdAt: '2026-01-16T09:00:00Z',
                      body: 'Looks good!',
                    },
                  ],
                },
              },
              {
                notes: {
                  nodes: [
                    {
                      author: { username: 'dave' },
                      createdAt: '2026-01-17T11:00:00Z',
                      body: 'Needs more tests.',
                    },
                  ],
                },
              },
            ],
          },
        },
      ],
    });

    const item = mapWorkItemToWorkItem(glWorkItem);

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
    expect(item.comments).toHaveLength(2);
    expect(item.comments[0]).toEqual({
      author: 'carol',
      date: '2026-01-16T09:00:00Z',
      body: 'Looks good!',
    });
    expect(item.comments[1]).toEqual({
      author: 'dave',
      date: '2026-01-17T11:00:00Z',
      body: 'Needs more tests.',
    });
  });

  it('maps an epic work item', () => {
    const glWorkItem = makeWorkItem({
      id: 'gid://gitlab/WorkItem/99',
      iid: '99',
      title: 'Big feature',
      workItemType: { name: 'Epic' },
      widgets: [
        {
          __typename: 'WorkItemWidgetDescription',
          description: 'Epic description here.',
        },
        {
          __typename: 'WorkItemWidgetLabels',
          labels: { nodes: [{ title: 'feature' }, { title: 'priority' }] },
        },
      ],
    });

    const item = mapWorkItemToWorkItem(glWorkItem);

    expect(item.id).toBe('epic-99');
    expect(item.title).toBe('Big feature');
    expect(item.description).toBe('Epic description here.');
    expect(item.type).toBe('epic');
    expect(item.labels).toEqual(['feature', 'priority']);
    expect(item.assignee).toBe('');
    expect(item.iteration).toBe('');
    expect(item.parent).toBeNull();
    expect(item.comments).toEqual([]);
  });

  it('maps CLOSED state to closed', () => {
    const glWorkItem = makeWorkItem({ state: 'CLOSED' });
    expect(mapWorkItemToWorkItem(glWorkItem).status).toBe('closed');
  });

  it('maps OPEN state to open', () => {
    const glWorkItem = makeWorkItem({ state: 'OPEN' });
    expect(mapWorkItemToWorkItem(glWorkItem).status).toBe('open');
  });

  it('handles missing widgets gracefully (empty widgets array)', () => {
    const glWorkItem = makeWorkItem({ widgets: [] });

    const item = mapWorkItemToWorkItem(glWorkItem);

    expect(item.description).toBe('');
    expect(item.assignee).toBe('');
    expect(item.labels).toEqual([]);
    expect(item.iteration).toBe('');
    expect(item.parent).toBeNull();
    expect(item.comments).toEqual([]);
  });

  it('handles unknown widget types gracefully', () => {
    const glWorkItem = makeWorkItem({
      widgets: [{ __typename: 'WorkItemWidgetSomethingNew' }],
    });

    const item = mapWorkItemToWorkItem(glWorkItem);

    expect(item.description).toBe('');
    expect(item.assignee).toBe('');
    expect(item.labels).toEqual([]);
  });

  it('handles null milestone', () => {
    const glWorkItem = makeWorkItem({
      widgets: [{ __typename: 'WorkItemWidgetMilestone', milestone: null }],
    });
    expect(mapWorkItemToWorkItem(glWorkItem).iteration).toBe('');
  });

  it('handles null parent in hierarchy widget', () => {
    const glWorkItem = makeWorkItem({
      widgets: [{ __typename: 'WorkItemWidgetHierarchy', parent: null }],
    });
    expect(mapWorkItemToWorkItem(glWorkItem).parent).toBeNull();
  });

  it('derives parent type from parent workItemType', () => {
    const glWorkItem = makeWorkItem({
      widgets: [
        {
          __typename: 'WorkItemWidgetHierarchy',
          parent: {
            id: 'gid://gitlab/WorkItem/10',
            iid: '10',
            workItemType: { name: 'Task' },
          },
        },
      ],
    });
    expect(mapWorkItemToWorkItem(glWorkItem).parent).toBe('task-10');
  });
});

describe('mapNoteToComment', () => {
  it('maps a GitLab note to a tic Comment', () => {
    const glNote: GlNote = {
      author: { username: 'alice' },
      createdAt: '2026-01-15T10:00:00Z',
      body: 'Looks good!',
    };

    const comment = mapNoteToComment(glNote);

    expect(comment.author).toBe('alice');
    expect(comment.date).toBe('2026-01-15T10:00:00Z');
    expect(comment.body).toBe('Looks good!');
  });
});
