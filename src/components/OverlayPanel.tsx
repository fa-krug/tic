export interface OverlayItem {
  id: string;
  label: string;
  value: string;
  hint?: string;
  category?: string;
  selected?: boolean;
}

export interface OverlayItemGroup {
  category: string;
  items: OverlayItem[];
}

export interface OverlayPanelProps {
  title: string;
  items: OverlayItem[];
  onSelect: (item: OverlayItem) => void;
  onCancel: () => void;
  multiSelect?: boolean;
  allowFreeform?: boolean;
  onSubmitFreeform?: (text: string) => void;
  onConfirm?: (items: OverlayItem[]) => void;
  placeholder?: string;
  initialQuery?: string;
  emptyMessage?: string;
  footer?: string;
}

export function filterItems(
  items: OverlayItem[],
  query: string,
): OverlayItem[] {
  if (query.trim() === '') return items;
  const q = query.toLowerCase();
  return items.filter((item) => item.label.toLowerCase().includes(q));
}

export function groupByCategory(items: OverlayItem[]): OverlayItemGroup[] {
  const groups: OverlayItemGroup[] = [];
  const seen = new Map<string, OverlayItemGroup>();

  for (const item of items) {
    const cat = item.category ?? '';
    let group = seen.get(cat);
    if (!group) {
      group = { category: cat, items: [] };
      seen.set(cat, group);
      groups.push(group);
    }
    group.items.push(item);
  }

  return groups;
}
