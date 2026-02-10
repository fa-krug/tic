import { describe, it, expect } from 'vitest';
import {
  applyFilters,
  countActiveFilters,
  summarizeFilters,
} from './filters.js';

const items = [
  {
    id: '1',
    status: 'open',
    type: 'bug',
    priority: 'high',
    assignee: 'alice',
    labels: ['frontend'],
  },
  {
    id: '2',
    status: 'done',
    type: 'task',
    priority: 'low',
    assignee: 'bob',
    labels: ['backend'],
  },
  {
    id: '3',
    status: 'open',
    type: 'task',
    priority: 'medium',
    assignee: 'alice',
    labels: ['frontend', 'urgent'],
  },
  {
    id: '4',
    status: 'in-progress',
    type: 'bug',
    priority: 'critical',
    assignee: 'charlie',
    labels: [],
  },
];

describe('applyFilters', () => {
  it('returns all items when filters are empty', () => {
    expect(applyFilters(items, {})).toEqual(items);
  });

  it('filters by status', () => {
    const result = applyFilters(items, { statuses: ['open'] });
    expect(result.map((i) => i.id)).toEqual(['1', '3']);
  });

  it('filters by multiple statuses (OR)', () => {
    const result = applyFilters(items, { statuses: ['open', 'done'] });
    expect(result.map((i) => i.id)).toEqual(['1', '2', '3']);
  });

  it('filters by type', () => {
    const result = applyFilters(items, { types: ['bug'] });
    expect(result.map((i) => i.id)).toEqual(['1', '4']);
  });

  it('filters by priority', () => {
    const result = applyFilters(items, {
      priorities: ['high', 'critical'],
    });
    expect(result.map((i) => i.id)).toEqual(['1', '4']);
  });

  it('filters by assignee', () => {
    const result = applyFilters(items, { assignees: ['alice'] });
    expect(result.map((i) => i.id)).toEqual(['1', '3']);
  });

  it('filters by labels (item matches if any label matches)', () => {
    const result = applyFilters(items, { labels: ['urgent'] });
    expect(result.map((i) => i.id)).toEqual(['3']);
  });

  it('ANDs across fields', () => {
    const result = applyFilters(items, {
      statuses: ['open'],
      types: ['bug'],
    });
    expect(result.map((i) => i.id)).toEqual(['1']);
  });

  it('empty array means no filter for that field', () => {
    const result = applyFilters(items, { statuses: [] });
    expect(result).toEqual(items);
  });
});

describe('countActiveFilters', () => {
  it('returns 0 for empty filters', () => {
    expect(countActiveFilters({})).toBe(0);
  });

  it('counts total filter values across fields', () => {
    expect(
      countActiveFilters({ statuses: ['open', 'done'], types: ['bug'] }),
    ).toBe(3);
  });
});

describe('summarizeFilters', () => {
  it('returns empty string for no filters', () => {
    expect(summarizeFilters({})).toBe('');
  });

  it('summarizes multiple fields', () => {
    expect(summarizeFilters({ statuses: ['open'], types: ['bug'] })).toBe(
      'status: open | type: bug',
    );
  });
});
