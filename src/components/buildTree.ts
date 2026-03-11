import type { SortEntry } from '../stores/listViewStore.js';
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
  // Build a map of ALL items for parent lookups (keyed by rowId)
  const allItemMap = new Map(allItems.map((i) => [i.rowId, i]));

  // Build children map from ALL items (children grouped by parent rowId)
  const childrenMap = new Map<number | null, WorkItem[]>();
  for (const item of allItems) {
    const parentId =
      item.parent !== null && allItemMap.has(item.parent) ? item.parent : null;
    if (!childrenMap.has(parentId)) childrenMap.set(parentId, []);
    childrenMap.get(parentId)!.push(item);
  }

  // Set of rowIds in the filtered (same-type) set — used to identify roots
  const filteredIds = new Set(filteredItems.map((i) => i.rowId));

  // Determine which rowIds have children (in allItems)
  const idsWithChildren = new Set<number>();
  for (const item of allItems) {
    if (item.parent !== null && allItemMap.has(item.parent)) {
      idsWithChildren.add(item.parent);
    }
  }

  const result: TreeItem[] = [];

  function walk(parentId: number | null, depth: number, parentPrefix: string) {
    const children = childrenMap.get(parentId) ?? [];
    children.forEach((child, idx) => {
      // At depth 0, only include items from the filtered set (same type)
      if (depth === 0 && !filteredIds.has(child.rowId)) return;

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
        hasChildren: idsWithChildren.has(child.rowId),
      });

      const nextParentPrefix =
        depth > 0 ? parentPrefix + (isLast ? '  ' : '│ ') : '';
      walk(child.rowId, depth + 1, nextParentPrefix);
    });
  }

  walk(null, 0, '');
  return result;
}

const PRIORITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function compareValues(a: WorkItem, b: WorkItem, entry: SortEntry): number {
  const { column, direction } = entry;
  let result = 0;

  switch (column) {
    case 'id': {
      const aId = a.id ?? '';
      const bId = b.id ?? '';
      const aNum = Number(aId);
      const bNum = Number(bId);
      if (!isNaN(aNum) && !isNaN(bNum)) {
        result = aNum - bNum;
      } else {
        result = aId.localeCompare(bId);
      }
      break;
    }
    case 'title':
      result = a.title.localeCompare(b.title, undefined, {
        sensitivity: 'base',
      });
      break;
    case 'status':
      result = a.status.localeCompare(b.status, undefined, {
        sensitivity: 'base',
      });
      break;
    case 'assignee':
      result = a.assignee.localeCompare(b.assignee, undefined, {
        sensitivity: 'base',
      });
      break;
    case 'priority': {
      const aRank = PRIORITY_RANK[a.priority] ?? 999;
      const bRank = PRIORITY_RANK[b.priority] ?? 999;
      result = aRank - bRank;
      break;
    }
    case 'created':
      result = a.created.localeCompare(b.created);
      break;
    case 'updated':
      result = a.updated.localeCompare(b.updated);
      break;
  }

  return direction === 'desc' ? -result : result;
}

export function sortTree(
  treeItems: TreeItem[],
  sortStack: SortEntry[],
): TreeItem[] {
  if (sortStack.length === 0) return treeItems;

  // Group items by parent (depth 0 items have parent null)
  const groups = new Map<number | null, { index: number; item: TreeItem }[]>();
  for (let i = 0; i < treeItems.length; i++) {
    const t = treeItems[i]!;
    const key = t.depth === 0 ? null : t.item.parent;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ index: i, item: t });
  }

  // Sort each sibling group
  for (const siblings of groups.values()) {
    siblings.sort((a, b) => {
      for (const entry of sortStack) {
        const cmp = compareValues(a.item.item, b.item.item, entry);
        if (cmp !== 0) return cmp;
      }
      return 0;
    });
  }

  // Reconstruct the flat list in tree order (DFS)
  const result: TreeItem[] = [];
  const childMap = new Map<number | null, TreeItem[]>();
  for (const [key, siblings] of groups) {
    childMap.set(
      key,
      siblings.map((s) => s.item),
    );
  }

  function walk(parentId: number | null) {
    const children = childMap.get(parentId);
    if (!children) return;
    for (const child of children) {
      result.push(child);
      walk(child.item.rowId);
    }
  }

  walk(null);
  return result;
}
