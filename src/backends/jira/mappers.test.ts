import { describe, it, expect } from 'vitest';
import {
  mapIssueToWorkItem,
  mapCommentToComment,
  mapPriorityToTic,
  mapPriorityToJira,
  extractDependsOn,
} from './mappers.js';

describe('mapPriorityToTic', () => {
  it('maps Highest to critical', () => {
    expect(mapPriorityToTic('Highest')).toBe('critical');
  });
  it('maps High to high', () => {
    expect(mapPriorityToTic('High')).toBe('high');
  });
  it('maps Medium to medium', () => {
    expect(mapPriorityToTic('Medium')).toBe('medium');
  });
  it('maps Low to low', () => {
    expect(mapPriorityToTic('Low')).toBe('low');
  });
  it('maps Lowest to low', () => {
    expect(mapPriorityToTic('Lowest')).toBe('low');
  });
  it('defaults to medium for unknown', () => {
    expect(mapPriorityToTic(undefined)).toBe('medium');
  });
});

describe('mapPriorityToJira', () => {
  it('maps critical to Highest', () => {
    expect(mapPriorityToJira('critical')).toBe('Highest');
  });
  it('maps high to High', () => {
    expect(mapPriorityToJira('high')).toBe('High');
  });
  it('maps medium to Medium', () => {
    expect(mapPriorityToJira('medium')).toBe('Medium');
  });
  it('maps low to Low', () => {
    expect(mapPriorityToJira('low')).toBe('Low');
  });
});

describe('extractDependsOn', () => {
  it('extracts keys from "is blocked by" inward links', () => {
    const links = [
      {
        type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
        inwardIssue: { key: 'TEAM-5' },
      },
      {
        type: { name: 'Blocks', inward: 'is blocked by', outward: 'blocks' },
        outwardIssue: { key: 'TEAM-10' },
      },
    ];
    expect(extractDependsOn(links)).toEqual(['TEAM-5']);
  });

  it('returns empty array for no links', () => {
    expect(extractDependsOn(undefined)).toEqual([]);
    expect(extractDependsOn([])).toEqual([]);
  });
});

describe('mapIssueToWorkItem', () => {
  it('maps a full Jira issue to a WorkItem', () => {
    const jiraIssue = {
      key: 'TEAM-42',
      fields: {
        summary: 'Fix login bug',
        description: 'The login form breaks on mobile.',
        status: { name: 'In Progress' },
        issuetype: { name: 'Bug' },
        priority: { name: 'High' },
        assignee: {
          displayName: 'Alice Smith',
          emailAddress: 'alice@example.com',
        },
        labels: ['bug', 'urgent'],
        sprint: { name: 'Sprint 5' },
        created: '2026-01-15T10:00:00.000+0000',
        updated: '2026-01-20T14:30:00.000+0000',
        parent: { key: 'TEAM-10' },
        issuelinks: [
          {
            type: {
              name: 'Blocks',
              inward: 'is blocked by',
              outward: 'blocks',
            },
            inwardIssue: { key: 'TEAM-5' },
          },
        ],
      },
    };

    const item = mapIssueToWorkItem(jiraIssue);

    expect(item.id).toBe('TEAM-42');
    expect(item.title).toBe('Fix login bug');
    expect(item.description).toBe('The login form breaks on mobile.');
    expect(item.status).toBe('in progress');
    expect(item.type).toBe('bug');
    expect(item.priority).toBe('high');
    expect(item.assignee).toBe('alice@example.com');
    expect(item.labels).toEqual(['bug', 'urgent']);
    expect(item.iteration).toBe('Sprint 5');
    expect(item.created).toBe('2026-01-15T10:00:00.000+0000');
    expect(item.updated).toBe('2026-01-20T14:30:00.000+0000');
    expect(item.parent).toBe('TEAM-10');
    expect(item.dependsOn).toEqual(['TEAM-5']);
    expect(item.comments).toEqual([]);
  });

  it('handles null/missing fields gracefully', () => {
    const jiraIssue = {
      key: 'TEAM-1',
      fields: {
        summary: 'Empty',
        description: null,
        status: { name: 'To Do' },
        issuetype: { name: 'Task' },
        priority: null,
        assignee: null,
        labels: [],
        sprint: null,
        created: '2026-01-01T00:00:00.000+0000',
        updated: '2026-01-01T00:00:00.000+0000',
        parent: null,
        issuelinks: [],
      },
    };

    const item = mapIssueToWorkItem(jiraIssue);

    expect(item.description).toBe('');
    expect(item.priority).toBe('medium');
    expect(item.assignee).toBe('');
    expect(item.iteration).toBe('');
    expect(item.parent).toBeNull();
    expect(item.dependsOn).toEqual([]);
  });
});

describe('mapCommentToComment', () => {
  it('maps a Jira comment to a tic Comment', () => {
    const jiraComment = {
      author: {
        displayName: 'Alice',
        emailAddress: 'alice@example.com',
      },
      created: '2026-01-15T10:00:00.000+0000',
      body: 'Looks good!',
    };

    const comment = mapCommentToComment(jiraComment);

    expect(comment.author).toBe('alice@example.com');
    expect(comment.date).toBe('2026-01-15T10:00:00.000+0000');
    expect(comment.body).toBe('Looks good!');
  });
});
