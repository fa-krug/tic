import type { WorkItem } from '../types.js';

export interface TreeItem {
  item: WorkItem;
  depth: number;
  prefix: string;
  isCrossType: boolean;
  hasChildren: boolean;
}

/**
 * Build a tree from work items. Roots come from filteredItems (matching activeType).
 * Children are pulled from allItems regardless of type.
 * Cross-type children are marked with isCrossType=true.
 */
export function buildTree(
  filteredItems: WorkItem[],
  allItems: WorkItem[],
  activeType: string,
): TreeItem[] {
  // Build a map of ALL items for parent lookups
  const allItemMap = new Map(allItems.map((i) => [i.id, i]));

  // Build children map from ALL items (children grouped by parent ID)
  const childrenMap = new Map<string | null, WorkItem[]>();
  for (const item of allItems) {
    const parentId =
      item.parent !== null && allItemMap.has(item.parent) ? item.parent : null;
    if (!childrenMap.has(parentId)) childrenMap.set(parentId, []);
    childrenMap.get(parentId)!.push(item);
  }

  // Set of IDs in the filtered (same-type) set — used to identify roots
  const filteredIds = new Set(filteredItems.map((i) => i.id));

  // Determine which IDs have children (in allItems)
  const idsWithChildren = new Set<string>();
  for (const item of allItems) {
    if (item.parent !== null && allItemMap.has(item.parent)) {
      idsWithChildren.add(item.parent);
    }
  }

  const result: TreeItem[] = [];

  function walk(parentId: string | null, depth: number, parentPrefix: string) {
    const children = childrenMap.get(parentId) ?? [];
    children.forEach((child, idx) => {
      // At depth 0, only include items from the filtered set (same type)
      if (depth === 0 && !filteredIds.has(child.id)) return;

      const isLast = idx === children.length - 1;
      let prefix = '';
      if (depth > 0) {
        prefix = parentPrefix + (isLast ? '└─' : '├─');
      }

      result.push({
        item: child,
        depth,
        prefix,
        isCrossType: child.type !== activeType,
        hasChildren: idsWithChildren.has(child.id),
      });

      const nextParentPrefix =
        depth > 0 ? parentPrefix + (isLast ? '  ' : '│ ') : '';
      walk(child.id, depth + 1, nextParentPrefix);
    });
  }

  walk(null, 0, '');
  return result;
}
