import { describe, it, expect } from 'vitest';
import type { PullRequest, NewPullRequest } from './types.js';

describe('PullRequest types', () => {
  it('accepts a valid PullRequest object', () => {
    const pr: PullRequest = {
      id: 'pr-1',
      number: 42,
      title: 'Fix login bug',
      description: 'Fixes the login timeout issue',
      status: 'open',
      sourceBranch: 'fix/login-bug',
      targetBranch: 'main',
      author: 'octocat',
      linkedItems: [1, 5],
      created: '2026-02-14T00:00:00Z',
      updated: '2026-02-14T00:00:00Z',
      url: 'https://github.com/owner/repo/pull/42',
    };
    expect(pr.number).toBe(42);
    expect(pr.status).toBe('open');
    expect(pr.linkedItems).toEqual([1, 5]);
  });

  it('accepts a valid NewPullRequest object', () => {
    const newPr: NewPullRequest = {
      title: 'Add feature',
      sourceBranch: 'feat/new-feature',
    };
    expect(newPr.title).toBe('Add feature');
    expect(newPr.targetBranch).toBeUndefined();
    expect(newPr.linkedItems).toBeUndefined();
  });
});
