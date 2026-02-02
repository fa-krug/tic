import { describe, it, expect } from 'vitest';
import { fuzzyMatch } from './fuzzyMatch.js';
import type { WorkItem } from '../types.js';

function makeItem(overrides: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    title: `Item ${overrides.id}`,
    type: 'task',
    status: 'open',
    iteration: 'sprint-1',
    priority: 'medium',
    assignee: '',
    labels: [],
    created: '',
    updated: '',
    description: '',
    comments: [],
    parent: null,
    dependsOn: [],
    ...overrides,
  };
}

describe('fuzzyMatch', () => {
  it('returns empty array for empty query', () => {
    const items = [makeItem({ id: '1', title: 'Auth bug' })];
    expect(fuzzyMatch(items, '')).toEqual([]);
  });

  it('matches by title substring', () => {
    const items = [
      makeItem({ id: '1', title: 'Auth bug on login' }),
      makeItem({ id: '2', title: 'Dashboard redesign' }),
    ];
    const results = fuzzyMatch(items, 'auth');
    expect(results.length).toBe(1);
    expect(results[0]!.item.id).toBe('1');
  });

  it('matches by ID', () => {
    const items = [
      makeItem({ id: '12', title: 'Something' }),
      makeItem({ id: '34', title: 'Other' }),
    ];
    const results = fuzzyMatch(items, '12');
    expect(results.length).toBe(1);
    expect(results[0]!.item.id).toBe('12');
  });

  it('matches by label', () => {
    const items = [
      makeItem({ id: '1', title: 'Foo', labels: ['critical', 'backend'] }),
      makeItem({ id: '2', title: 'Bar', labels: ['frontend'] }),
    ];
    const results = fuzzyMatch(items, 'backend');
    expect(results.length).toBe(1);
    expect(results[0]!.item.id).toBe('1');
  });

  it('is case insensitive', () => {
    const items = [makeItem({ id: '1', title: 'Auth Bug' })];
    const results = fuzzyMatch(items, 'auth bug');
    expect(results.length).toBe(1);
  });

  it('ranks exact prefix matches higher', () => {
    const items = [
      makeItem({ id: '1', title: 'Authentication service' }),
      makeItem({ id: '2', title: 'OAuth integration' }),
    ];
    const results = fuzzyMatch(items, 'auth');
    expect(results[0]!.item.id).toBe('1');
  });

  it('returns multiple matches sorted by score', () => {
    const items = [
      makeItem({ id: '1', title: 'Fix auth token' }),
      makeItem({ id: '2', title: 'Auth bug on login' }),
      makeItem({ id: '3', title: 'Dashboard' }),
    ];
    const results = fuzzyMatch(items, 'auth');
    expect(results.length).toBe(2);
    // "Auth bug" starts with auth, so should rank higher
    expect(results[0]!.item.id).toBe('2');
  });
});
