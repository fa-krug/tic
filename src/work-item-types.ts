/**
 * Names trackers use for their main backlog item, in order of preference.
 * Covers the Azure DevOps processes (Agile: User Story, Scrum: Product
 * Backlog Item, CMMI: Requirement, Basic: Issue), tic's own `issue`, and
 * Jira's `story`. Matched case-insensitively.
 */
export const BACKLOG_TYPE_NAMES = [
  'User Story',
  'Product Backlog Item',
  'Requirement',
  'Issue',
  'Story',
];

export interface PickDefaultTypeOptions {
  /** Type the backend itself reports as its default (e.g. Azure's requirement category). */
  backendDefault?: string | null;
  /** Items whose most common type is used when nothing else matches. */
  items?: readonly { type: string }[];
}

/**
 * Choose the work item type to show and create by default.
 *
 * Order: the configured default when the backend has it, the backend's own
 * default, a known backlog type, the type with the most items, the first type.
 * Returns undefined only when there are no types.
 */
export function pickDefaultType(
  types: readonly string[],
  configured?: string | null,
  options: PickDefaultTypeOptions = {},
): string | undefined {
  if (types.length === 0) return undefined;
  if (configured && types.includes(configured)) return configured;

  const { backendDefault, items } = options;
  if (backendDefault && types.includes(backendDefault)) return backendDefault;

  for (const name of BACKLOG_TYPE_NAMES) {
    const match = types.find((t) => t.toLowerCase() === name.toLowerCase());
    if (match) return match;
  }

  if (items && items.length > 0) {
    const counts = new Map<string, number>();
    for (const item of items) {
      counts.set(item.type, (counts.get(item.type) ?? 0) + 1);
    }
    let best: string | undefined;
    let bestCount = 0;
    for (const type of types) {
      const count = counts.get(type) ?? 0;
      if (count > bestCount) {
        best = type;
        bestCount = count;
      }
    }
    if (best) return best;
  }

  return types[0];
}

/** Whether the list can switch between types (Tab, "Switch to …"). */
export function canSwitchTypes(types: readonly string[]): boolean {
  return types.length > 1;
}

/** The type after `activeType`, wrapping around; the first type when `activeType` is unknown. */
export function nextType(
  types: readonly string[],
  activeType: string | null,
): string | undefined {
  if (types.length === 0) return undefined;
  const idx = activeType === null ? -1 : types.indexOf(activeType);
  return types[(idx + 1) % types.length];
}
