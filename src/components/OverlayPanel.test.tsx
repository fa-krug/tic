import { describe, it, expect } from 'vitest';
import { render } from 'ink-testing-library';
import {
  OverlayPanel,
  filterItems,
  groupByCategory,
  type OverlayItem,
} from './OverlayPanel.js';

function makeItem(
  overrides: Partial<OverlayItem> & { id: string },
): OverlayItem {
  return {
    label: overrides.id,
    value: overrides.id,
    ...overrides,
  };
}

describe('filterItems', () => {
  const items: OverlayItem[] = [
    makeItem({ id: '1', label: 'Critical' }),
    makeItem({ id: '2', label: 'High' }),
    makeItem({ id: '3', label: 'Medium' }),
    makeItem({ id: '4', label: 'Low' }),
  ];

  it('returns all items when query is empty', () => {
    expect(filterItems(items, '')).toHaveLength(4);
  });

  it('filters by case-insensitive substring', () => {
    const result = filterItems(items, 'cri');
    expect(result).toHaveLength(1);
    expect(result[0]!.label).toBe('Critical');
  });

  it('returns empty array when nothing matches', () => {
    expect(filterItems(items, 'zzz')).toHaveLength(0);
  });

  it('is case insensitive', () => {
    const result = filterItems(items, 'HIGH');
    expect(result.map((i) => i.label)).toContain('High');
  });

  it('matches partial substrings', () => {
    const result = filterItems(items, 'edi');
    expect(result.map((i) => i.label)).toContain('Medium');
  });
});

describe('groupByCategory', () => {
  it('groups items by category preserving order', () => {
    const items: OverlayItem[] = [
      makeItem({ id: '1', label: 'A', category: 'Actions' }),
      makeItem({ id: '2', label: 'B', category: 'Navigation' }),
      makeItem({ id: '3', label: 'C', category: 'Actions' }),
    ];
    const groups = groupByCategory(items);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.category).toBe('Actions');
    expect(groups[0]!.items).toHaveLength(2);
    expect(groups[1]!.category).toBe('Navigation');
    expect(groups[1]!.items).toHaveLength(1);
  });

  it('returns single group with empty category for uncategorized items', () => {
    const items: OverlayItem[] = [
      makeItem({ id: '1', label: 'A' }),
      makeItem({ id: '2', label: 'B' }),
    ];
    const groups = groupByCategory(items);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.category).toBe('');
    expect(groups[0]!.items).toHaveLength(2);
  });

  it('preserves item order within groups', () => {
    const items: OverlayItem[] = [
      makeItem({ id: '1', label: 'Zebra', category: 'Animals' }),
      makeItem({ id: '2', label: 'Apple', category: 'Animals' }),
    ];
    const groups = groupByCategory(items);
    expect(groups[0]!.items[0]!.label).toBe('Zebra');
    expect(groups[0]!.items[1]!.label).toBe('Apple');
  });
});

describe('OverlayPanel current marker', () => {
  const items: OverlayItem[] = [
    makeItem({ id: 'sprint-1', label: 'sprint-1' }),
    makeItem({ id: 'sprint-2', label: 'sprint-2' }),
  ];

  it('marks the current item with a dot', () => {
    const { lastFrame } = render(
      <OverlayPanel
        title="Set Iteration"
        items={items}
        currentId="sprint-2"
        onSelect={() => {}}
        onCancel={() => {}}
      />,
    );
    const lines = lastFrame()!.split('\n');
    expect(lines.find((l) => l.includes('sprint-2'))).toContain('●');
    expect(lines.find((l) => l.includes('sprint-1'))).not.toContain('●');
  });

  it('marks nothing when no current item is given', () => {
    const { lastFrame } = render(
      <OverlayPanel
        title="Set Iteration"
        items={items}
        onSelect={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(lastFrame()).not.toContain('●');
  });
});
