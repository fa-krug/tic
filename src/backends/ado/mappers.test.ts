import { describe, it, expect } from 'vitest';
import {
  mapWorkItemToWorkItem,
  mapCommentToComment,
  mapPriorityToTic,
  mapPriorityToAdo,
  parseTags,
  formatTags,
  extractParent,
  extractPredecessors,
} from './mappers.js';

const sampleAdoWorkItem = {
  id: 42,
  fields: {
    'System.Title': 'Fix login bug',
    'System.WorkItemType': 'User Story',
    'System.State': 'Active',
    'System.IterationPath': 'MyProject\\Sprint 1',
    'Microsoft.VSTS.Common.Priority': 2,
    'System.AssignedTo': {
      displayName: 'Alice Smith',
      uniqueName: 'alice@example.com',
    },
    'System.Tags': 'bug; frontend; urgent',
    'System.Description': '<p>The login form breaks.</p>',
    'System.CreatedDate': '2026-01-15T10:00:00Z',
    'System.ChangedDate': '2026-01-20T14:30:00Z',
  },
  relations: [
    {
      rel: 'System.LinkTypes.Hierarchy-Reverse',
      url: 'https://dev.azure.com/contoso/_apis/wit/workItems/10',
      attributes: {},
    },
    {
      rel: 'System.LinkTypes.Dependency-Reverse',
      url: 'https://dev.azure.com/contoso/_apis/wit/workItems/20',
      attributes: {},
    },
    {
      rel: 'System.LinkTypes.Dependency-Reverse',
      url: 'https://dev.azure.com/contoso/_apis/wit/workItems/21',
      attributes: {},
    },
  ],
};

describe('mapPriorityToTic', () => {
  it('maps 1 to critical', () => expect(mapPriorityToTic(1)).toBe('critical'));
  it('maps 2 to high', () => expect(mapPriorityToTic(2)).toBe('high'));
  it('maps 3 to medium', () => expect(mapPriorityToTic(3)).toBe('medium'));
  it('maps 4 to low', () => expect(mapPriorityToTic(4)).toBe('low'));
  it('defaults to medium for undefined', () =>
    expect(mapPriorityToTic(undefined)).toBe('medium'));
});

describe('mapPriorityToAdo', () => {
  it('maps critical to 1', () => expect(mapPriorityToAdo('critical')).toBe(1));
  it('maps high to 2', () => expect(mapPriorityToAdo('high')).toBe(2));
  it('maps medium to 3', () => expect(mapPriorityToAdo('medium')).toBe(3));
  it('maps low to 4', () => expect(mapPriorityToAdo('low')).toBe(4));
});

describe('parseTags', () => {
  it('splits semicolon-separated tags', () => {
    expect(parseTags('bug; frontend; urgent')).toEqual([
      'bug',
      'frontend',
      'urgent',
    ]);
  });

  it('returns empty array for empty string', () => {
    expect(parseTags('')).toEqual([]);
  });

  it('returns empty array for undefined', () => {
    expect(parseTags(undefined)).toEqual([]);
  });

  it('trims whitespace from tags', () => {
    expect(parseTags('  a ;  b  ')).toEqual(['a', 'b']);
  });
});

describe('formatTags', () => {
  it('joins tags with semicolon and space', () => {
    expect(formatTags(['bug', 'frontend'])).toBe('bug; frontend');
  });

  it('returns empty string for empty array', () => {
    expect(formatTags([])).toBe('');
  });
});

describe('extractParent', () => {
  it('extracts parent ID from Hierarchy-Reverse relation', () => {
    expect(extractParent(sampleAdoWorkItem.relations)).toBe('10');
  });

  it('returns null when no parent relation exists', () => {
    expect(extractParent([])).toBeNull();
    expect(extractParent(undefined)).toBeNull();
  });
});

describe('extractPredecessors', () => {
  it('extracts predecessor IDs from Dependency-Reverse relations', () => {
    expect(extractPredecessors(sampleAdoWorkItem.relations)).toEqual([
      '20',
      '21',
    ]);
  });

  it('returns empty array when no predecessor relations', () => {
    expect(extractPredecessors([])).toEqual([]);
    expect(extractPredecessors(undefined)).toEqual([]);
  });
});

describe('mapWorkItemToWorkItem', () => {
  it('maps a full ADO work item to a tic WorkItem', () => {
    const item = mapWorkItemToWorkItem(sampleAdoWorkItem);

    expect(item.id).toBe('42');
    expect(item.title).toBe('Fix login bug');
    expect(item.type).toBe('User Story');
    expect(item.status).toBe('Active');
    expect(item.iteration).toBe('MyProject\\Sprint 1');
    expect(item.priority).toBe('high');
    expect(item.assignee).toBe('Alice Smith');
    expect(item.labels).toEqual(['bug', 'frontend', 'urgent']);
    expect(item.description).toBe('The login form breaks.');
    expect(item.created).toBe('2026-01-15T10:00:00Z');
    expect(item.updated).toBe('2026-01-20T14:30:00Z');
    expect(item.parent).toBe('10');
    expect(item.dependsOn).toEqual(['20', '21']);
    expect(item.comments).toEqual([]);
  });

  it('handles missing optional fields', () => {
    const minimal = {
      id: 1,
      fields: {
        'System.Title': 'Minimal item',
        'System.WorkItemType': 'Task',
        'System.State': 'New',
        'System.IterationPath': 'MyProject',
        'System.CreatedDate': '2026-01-01T00:00:00Z',
        'System.ChangedDate': '2026-01-01T00:00:00Z',
      },
    };

    const item = mapWorkItemToWorkItem(minimal);

    expect(item.id).toBe('1');
    expect(item.priority).toBe('medium');
    expect(item.assignee).toBe('');
    expect(item.labels).toEqual([]);
    expect(item.description).toBe('');
    expect(item.parent).toBeNull();
    expect(item.dependsOn).toEqual([]);
  });
});

describe('mapCommentToComment', () => {
  it('maps an ADO comment to a tic Comment', () => {
    const adoComment = {
      createdBy: { displayName: 'Alice Smith' },
      createdDate: '2026-01-16T09:00:00Z',
      text: '<p>I can reproduce this.</p>',
    };

    const comment = mapCommentToComment(adoComment);

    expect(comment.author).toBe('Alice Smith');
    expect(comment.date).toBe('2026-01-16T09:00:00Z');
    expect(comment.body).toBe('I can reproduce this.');
  });
});
