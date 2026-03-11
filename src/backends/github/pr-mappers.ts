import type { PullRequest, PullRequestStatus } from '../../types.js';

export interface GhPullRequest {
  number: number;
  title: string;
  body: string | null;
  state: string;
  draft: boolean;
  merged: boolean;
  head: { ref: string };
  base: { ref: string };
  user: { login: string };
  html_url: string;
  created_at: string;
  updated_at: string;
}

function ghStateToPrStatus(gh: GhPullRequest): PullRequestStatus {
  if (gh.merged) return 'merged';
  if (gh.draft) return 'draft';
  if (gh.state === 'closed') return 'closed';
  return 'open';
}

/**
 * Extract linked issue numbers from PR body.
 * Matches: closes #N, fixes #N, resolves #N (case-insensitive)
 */
export function extractLinkedIssues(body: string | null): number[] {
  if (!body) return [];
  const regex = /(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;
  const ids = new Set<number>();
  let match;
  while ((match = regex.exec(body)) !== null) {
    ids.add(Number(match[1]!));
  }
  return [...ids];
}

export function mapGhPrToPullRequest(gh: GhPullRequest): PullRequest {
  return {
    id: `pr-${gh.number}`,
    number: gh.number,
    title: gh.title,
    description: gh.body ?? '',
    status: ghStateToPrStatus(gh),
    sourceBranch: gh.head.ref,
    targetBranch: gh.base.ref,
    author: gh.user.login,
    linkedItems: extractLinkedIssues(gh.body),
    created: gh.created_at,
    updated: gh.updated_at,
    url: gh.html_url,
  };
}
