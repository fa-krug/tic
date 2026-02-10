import type { SortEntry } from './stores/listViewStore.js';

export interface ViewFilters {
  statuses?: string[];
  types?: string[];
  priorities?: string[];
  assignees?: string[];
  labels?: string[];
}

export interface SavedView {
  name: string;
  filters: ViewFilters;
  sort?: SortEntry[];
}

/**
 * Apply ViewFilters to a list of work items.
 * Each non-empty array is an inclusion filter (OR within field, AND across fields).
 */
export function applyFilters<
  T extends {
    status: string;
    type: string;
    priority: string;
    assignee: string;
    labels: string[];
  },
>(items: T[], filters: ViewFilters): T[] {
  let result = items;
  if (filters.statuses?.length) {
    result = result.filter((i) => filters.statuses!.includes(i.status));
  }
  if (filters.types?.length) {
    result = result.filter((i) => filters.types!.includes(i.type));
  }
  if (filters.priorities?.length) {
    result = result.filter((i) => filters.priorities!.includes(i.priority));
  }
  if (filters.assignees?.length) {
    result = result.filter((i) => filters.assignees!.includes(i.assignee));
  }
  if (filters.labels?.length) {
    result = result.filter((i) =>
      i.labels.some((l) => filters.labels!.includes(l)),
    );
  }
  return result;
}

/** Count the total number of active filter values across all fields. */
export function countActiveFilters(filters: ViewFilters): number {
  return (
    (filters.statuses?.length ?? 0) +
    (filters.types?.length ?? 0) +
    (filters.priorities?.length ?? 0) +
    (filters.assignees?.length ?? 0) +
    (filters.labels?.length ?? 0)
  );
}

/** Summarize active filters as a short string, e.g. "status: open, done | type: bug" */
export function summarizeFilters(filters: ViewFilters): string {
  const parts: string[] = [];
  if (filters.statuses?.length)
    parts.push(`status: ${filters.statuses.join(', ')}`);
  if (filters.types?.length) parts.push(`type: ${filters.types.join(', ')}`);
  if (filters.priorities?.length)
    parts.push(`priority: ${filters.priorities.join(', ')}`);
  if (filters.assignees?.length)
    parts.push(`assignee: ${filters.assignees.join(', ')}`);
  if (filters.labels?.length)
    parts.push(`labels: ${filters.labels.join(', ')}`);
  return parts.join(' | ');
}
