import { describe, it, expect } from 'vitest';
import { linkBranchToItem } from './branch-links.js';
import type { WorkItem } from './types.js';

describe('linkBranchToItem', () => {
  const items: WorkItem[] = [
    {
      id: '42',
      title: 'Add login page',
      type: 'task',
      status: 'open',
      iteration: '',
      priority: 'medium',
      assignee: '',
      labels: [],
      created: '',
      updated: '',
      description: '',
      comments: [],
      parent: null,
      dependsOn: [],
    },
    {
      id: '100',
      title: 'Fix bug',
      type: 'bug',
      status: 'open',
      iteration: '',
      priority: 'medium',
      assignee: '',
      labels: [],
      created: '',
      updated: '',
      description: '',
      comments: [],
      parent: null,
      dependsOn: [],
    },
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
