import { describe, it, expect } from 'vitest';
import { getMarkedDistribution } from './getMarkedDistribution.js';

describe('getMarkedDistribution', () => {
  // Helper: create tree items with given rowIds
  const items = (ids: number[]) =>
    ids.map((rowId) => ({ rowId }) as { rowId: number });

  it('returns zeros when no items are marked', () => {
    const result = getMarkedDistribution(new Set(), items([1, 2, 3]), 0, 3);
    expect(result).toEqual({ above: 0, below: 0 });
  });

  it('returns zeros when all marked items are visible', () => {
    const result = getMarkedDistribution(
      new Set([2, 3]),
      items([1, 2, 3, 4]),
      1,
      3,
    );
    expect(result).toEqual({ above: 0, below: 0 });
  });

  it('counts marked items above viewport', () => {
    const result = getMarkedDistribution(
      new Set([1, 2]),
      items([1, 2, 3, 4]),
      2,
      4,
    );
    expect(result).toEqual({ above: 2, below: 0 });
  });

  it('counts marked items below viewport', () => {
    const result = getMarkedDistribution(
      new Set([3, 4]),
      items([1, 2, 3, 4]),
      0,
      2,
    );
    expect(result).toEqual({ above: 0, below: 2 });
  });

  it('counts marked items in both directions', () => {
    const result = getMarkedDistribution(
      new Set([1, 3, 5]),
      items([1, 2, 3, 4, 5]),
      1,
      4,
    );
    expect(result).toEqual({ above: 1, below: 1 });
  });

  it('handles empty tree items', () => {
    const result = getMarkedDistribution(new Set([1]), items([]), 0, 0);
    expect(result).toEqual({ above: 0, below: 0 });
  });

  it('ignores marked ids not in tree items', () => {
    const result = getMarkedDistribution(
      new Set([999]),
      items([1, 2, 3]),
      0,
      3,
    );
    expect(result).toEqual({ above: 0, below: 0 });
  });
});
