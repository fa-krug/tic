import { describe, it, expect } from 'vitest';
import { groupResults } from './SearchOverlay.js';
import type { WorkItem } from '../types.js';
import type { FuzzyResult } from './fuzzyMatch.js';

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

describe('groupResults', () => {
  it('puts current iteration items first', () => {
    const results: FuzzyResult[] = [
      { item: makeItem({ id: '1', iteration: 'sprint-2' }), score: 50 },
      { item: makeItem({ id: '2', iteration: 'sprint-1' }), score: 50 },
    ];
    const grouped = groupResults(results, 'sprint-1');
    expect(grouped[0]!.item.id).toBe('2');
    expect(grouped[1]!.item.id).toBe('1');
  });

  it('preserves score order within groups', () => {
    const results: FuzzyResult[] = [
      { item: makeItem({ id: '1', iteration: 'sprint-1' }), score: 40 },
      { item: makeItem({ id: '2', iteration: 'sprint-1' }), score: 80 },
    ];
    const grouped = groupResults(results, 'sprint-1');
    expect(grouped[0]!.item.id).toBe('2');
    expect(grouped[1]!.item.id).toBe('1');
  });

  it('returns flat list when currentIteration is null', () => {
    const results: FuzzyResult[] = [
      { item: makeItem({ id: '1', iteration: 'sprint-1' }), score: 80 },
      { item: makeItem({ id: '2', iteration: 'sprint-2' }), score: 40 },
    ];
    const grouped = groupResults(results, null);
    expect(grouped[0]!.item.id).toBe('1');
    expect(grouped[1]!.item.id).toBe('2');
  });

  it('limits results to max count', () => {
    const results: FuzzyResult[] = Array.from({ length: 20 }, (_, i) => ({
      item: makeItem({ id: String(i), iteration: 'sprint-1' }),
      score: 50,
    }));
    const grouped = groupResults(results, 'sprint-1', 10);
    expect(grouped.length).toBe(10);
  });
});
