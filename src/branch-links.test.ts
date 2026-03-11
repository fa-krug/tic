import { describe, it, expect } from 'vitest';
import { linkBranchToItem } from './branch-links.js';
import { makeWorkItem } from './test-helpers.js';

describe('linkBranchToItem', () => {
  const items = [
    makeWorkItem(1, { id: '42', title: 'Add login page', status: 'open' }),
    makeWorkItem(2, {
      id: '100',
      title: 'Fix bug',
      type: 'bug',
      status: 'open',
    }),
  ];

  it('matches tic/{id}-{slug} pattern', () => {
    const result = linkBranchToItem('tic/42-add-login-page', items);
    expect(result).toEqual(items[0]);
  });

  it('returns null for non-tic branches', () => {
    const result = linkBranchToItem('feature/something', items);
    expect(result).toBeNull();
  });

  it('returns null when item ID not found', () => {
    const result = linkBranchToItem('tic/999-unknown', items);
    expect(result).toBeNull();
  });

  it('handles tic/{id} without slug', () => {
    const result = linkBranchToItem('tic/42', items);
    expect(result).toEqual(items[0]);
  });
});
