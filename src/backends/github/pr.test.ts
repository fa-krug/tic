import { describe, it, expect } from 'vitest';
import { mapGhPrToPullRequest, extractLinkedIssues } from './pr-mappers.js';
import type { GhPullRequest } from './pr-mappers.js';

function makeGhPr(overrides: Partial<GhPullRequest> = {}): GhPullRequest {
  return {
    number: 1,
    title: 'Add feature',
    body: 'Description of changes',
    state: 'open',
    draft: false,
    merged: false,
    head: { ref: 'feature-branch' },
    base: { ref: 'main' },
    user: { login: 'alice' },
    html_url: 'https://github.com/owner/repo/pull/1',
    created_at: '2026-01-15T10:00:00Z',
    updated_at: '2026-01-20T14:30:00Z',
    ...overrides,
  };
}

describe('mapGhPrToPullRequest', () => {
  it('maps an open PR correctly', () => {
    const gh = makeGhPr();
    const pr = mapGhPrToPullRequest(gh);

    expect(pr.id).toBe('pr-1');
    expect(pr.number).toBe(1);
    expect(pr.title).toBe('Add feature');
    expect(pr.description).toBe('Description of changes');
    expect(pr.status).toBe('open');
    expect(pr.sourceBranch).toBe('feature-branch');
    expect(pr.targetBranch).toBe('main');
    expect(pr.author).toBe('alice');
    expect(pr.linkedItems).toEqual([]);
    expect(pr.created).toBe('2026-01-15T10:00:00Z');
    expect(pr.updated).toBe('2026-01-20T14:30:00Z');
    expect(pr.url).toBe('https://github.com/owner/repo/pull/1');
  });

  it('maps a merged PR (merged=true -> status merged)', () => {
    const gh = makeGhPr({ merged: true, state: 'closed' });
    const pr = mapGhPrToPullRequest(gh);

    expect(pr.status).toBe('merged');
  });

  it('maps a draft PR (draft=true -> status draft)', () => {
    const gh = makeGhPr({ draft: true });
    const pr = mapGhPrToPullRequest(gh);

    expect(pr.status).toBe('draft');
  });

  it('maps a closed PR (state=closed, merged=false -> status closed)', () => {
    const gh = makeGhPr({ state: 'closed', merged: false });
    const pr = mapGhPrToPullRequest(gh);

    expect(pr.status).toBe('closed');
  });

  it('handles null body', () => {
    const gh = makeGhPr({ body: null });
    const pr = mapGhPrToPullRequest(gh);

    expect(pr.description).toBe('');
    expect(pr.linkedItems).toEqual([]);
  });

  it('extracts linked issues from body', () => {
    const gh = makeGhPr({ body: 'This closes #5 and fixes #10' });
    const pr = mapGhPrToPullRequest(gh);

    expect(pr.linkedItems).toEqual([5, 10]);
  });
});

describe('extractLinkedIssues', () => {
  it('parses "closes #5"', () => {
    expect(extractLinkedIssues('closes #5')).toEqual([5]);
  });

  it('parses "fixes #3, resolves #7"', () => {
    const result = extractLinkedIssues('fixes #3, resolves #7');
    expect(result).toEqual([3, 7]);
  });

  it('returns [] for null body', () => {
    expect(extractLinkedIssues(null)).toEqual([]);
  });

  it('is case-insensitive ("Closes #5" works)', () => {
    expect(extractLinkedIssues('Closes #5')).toEqual([5]);
  });

  it('handles multiple keyword forms', () => {
    const body =
      'Closed #1, Fixed #2, Resolved #3, Close #4, Fix #5, Resolve #6';
    const result = extractLinkedIssues(body);
    expect(result).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('deduplicates issue numbers', () => {
    const body = 'closes #5 and also fixes #5';
    expect(extractLinkedIssues(body)).toEqual([5]);
  });

  it('returns [] for body with no linked issues', () => {
    expect(extractLinkedIssues('Just a regular description')).toEqual([]);
  });
});
