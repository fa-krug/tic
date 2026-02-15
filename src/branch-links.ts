import type { WorkItem } from './types.js';

/**
 * Match a branch name to a work item by extracting the ID from
 * the `tic/{id}-{slug}` or `tic/{id}` naming convention.
 * Returns the matching WorkItem or null.
 */
export function linkBranchToItem(
  branchName: string,
  items: WorkItem[],
): WorkItem | null {
  const match = branchName.match(/^tic\/([^-/]+)/);
  if (!match) return null;
  const id = match[1]!;
  return items.find((item) => item.id === id) ?? null;
}
