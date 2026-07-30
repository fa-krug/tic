import { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from './TextInput.js';
import { useScrollViewport } from '../hooks/useScrollViewport.js';
import { useThemeStore, autoFg } from '../stores/themeStore.js';
import type { FieldType } from '../stores/themeStore.js';
import { ColorPill } from './ColorPill.js';

export interface OverlayItem {
  id: string;
  label: string;
  value: string;
  hint?: string;
  category?: string;
  selected?: boolean;
  kind?: 'command' | 'issue' | 'pr' | 'branch';
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
  onAction?: (item: OverlayItem) => void;
  placeholder?: string;
  initialQuery?: string;
  emptyMessage?: string;
  footer?: string;
  externalFilter?: boolean;
  onQueryChange?: (query: string) => void;
  fieldType?: FieldType;
  initialSelectedId?: string;
  /** Item id holding the value currently set on the target(s); marked with ●. */
  currentId?: string;
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

export function OverlayPanel({
  title,
  items,
  onSelect,
  onCancel,
  multiSelect = false,
  allowFreeform = false,
  onSubmitFreeform,
  onConfirm,
  onAction,
  placeholder = 'Type to filter...',
  initialQuery = '',
  emptyMessage = 'No matches',
  footer,
  externalFilter = false,
  onQueryChange,
  fieldType,
  initialSelectedId,
  currentId,
}: OverlayPanelProps) {
  const [query, setQuery] = useState(initialQuery);
  const [selectedIndex, setSelectedIndex] = useState(() => {
    if (initialSelectedId === undefined) return 0;
    const idx = items.findIndex((i) => i.id === initialSelectedId);
    return idx === -1 ? 0 : idx;
  });
  const [toggled, setToggled] = useState<Set<string>>(() => {
    if (!multiSelect) return new Set();
    return new Set(items.filter((i) => i.selected).map((i) => i.id));
  });

  const filtered = useMemo(
    () => (externalFilter ? items : filterItems(items, query)),
    [items, query, externalFilter],
  );
  const groups = useMemo(() => groupByCategory(filtered), [filtered]);
  const flatItems = useMemo(() => groups.flatMap((g) => g.items), [groups]);

  const hasCategories = items.some((i) => i.category);

  // Clamp selected index
  const clampedIndex = Math.min(
    selectedIndex,
    Math.max(0, flatItems.length - 1),
  );

  const categoryCount = hasCategories ? groups.length : 0;
  const viewport = useScrollViewport({
    totalItems: flatItems.length + categoryCount,
    cursor: clampedIndex,
    chromeLines: 7,
    linesPerItem: 1,
  });

  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(flatItems.length - 1, i + 1));
      return;
    }
    if (key.return) {
      if (multiSelect) {
        const selectedItems = items.filter((i) => toggled.has(i.id));
        if (onConfirm) {
          onConfirm(selectedItems);
        }
        onCancel();
        return;
      }
      if (flatItems.length > 0 && flatItems[clampedIndex]) {
        onSelect(flatItems[clampedIndex]);
      } else if (allowFreeform && query.trim() !== '' && onSubmitFreeform) {
        onSubmitFreeform(query.trim());
      }
      return;
    }
    if (
      key.tab &&
      onAction &&
      flatItems.length > 0 &&
      flatItems[clampedIndex]
    ) {
      onAction(flatItems[clampedIndex]);
      return;
    }
    if (_input === ' ' && multiSelect) {
      const current = flatItems[clampedIndex];
      if (current) {
        setToggled((prev) => {
          const next = new Set(prev);
          if (next.has(current.id)) {
            next.delete(current.id);
          } else {
            next.add(current.id);
          }
          return next;
        });
      }
      return;
    }
  });

  const handleQueryChange = (value: string) => {
    // In multiSelect mode, space is used for toggling, not filtering
    if (multiSelect) {
      value = value.replaceAll(' ', '');
      if (value === query) return;
    }
    setQuery(value);
    setSelectedIndex(0);
    if (onQueryChange) onQueryChange(value);
  };

  const { accent, mutedDim, selectionBg } = useThemeStore((s) => s.colors);

  const defaultFooter = multiSelect
    ? 'space toggle  enter confirm  esc cancel'
    : '↑↓ navigate  enter select  esc cancel';

  const visibleItems = flatItems.slice(viewport.start, viewport.end);
  const visibleGroups = hasCategories
    ? groupByCategory(visibleItems)
    : [{ category: '', items: visibleItems }];

  let selectableIdx = 0;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={accent}
      paddingX={1}
    >
      <Box marginBottom={1}>
        <Text bold color={accent}>
          {title}{' '}
        </Text>
        <TextInput
          value={query}
          onChange={handleQueryChange}
          focus={true}
          placeholder={placeholder}
        />
      </Box>

      {flatItems.length === 0 && (
        <Text dimColor={mutedDim}>{emptyMessage}</Text>
      )}

      {visibleGroups.map((group) => (
        <Box key={group.category || '__default'} flexDirection="column">
          {group.category !== '' && (
            <Box marginTop={1}>
              <Text dimColor={mutedDim} bold>
                {group.category}
              </Text>
            </Box>
          )}
          {group.items.map((item) => {
            const idx = selectableIdx++;
            const isSelected = idx === viewport.visibleCursor;
            const isToggled = toggled.has(item.id);
            const isCurrent = currentId !== undefined && item.id === currentId;

            return (
              <Box
                key={item.id}
                backgroundColor={isSelected ? selectionBg : undefined}
              >
                <Text
                  color={isSelected ? autoFg(selectionBg) : undefined}
                  bold={isSelected}
                >
                  {multiSelect
                    ? isToggled
                      ? '☑ '
                      : '☐ '
                    : isSelected
                      ? '> '
                      : '  '}
                </Text>
                <Box flexGrow={1} gap={1}>
                  {fieldType && !item.value.startsWith('__') ? (
                    <ColorPill
                      field={fieldType}
                      value={item.value}
                      selectionBg={isSelected ? selectionBg : undefined}
                    />
                  ) : (
                    <Text
                      color={isSelected ? autoFg(selectionBg) : undefined}
                      bold={isSelected || isCurrent}
                    >
                      {item.label}
                    </Text>
                  )}
                  {isCurrent && (
                    <Text color={isSelected ? autoFg(selectionBg) : accent}>
                      ●
                    </Text>
                  )}
                </Box>
                {item.hint && (
                  <Text
                    color={isSelected ? autoFg(selectionBg) : undefined}
                    dimColor={!isSelected ? mutedDim : undefined}
                  >
                    {' '}
                    {item.hint}
                  </Text>
                )}
              </Box>
            );
          })}
        </Box>
      ))}

      <Box marginTop={1}>
        <Text dimColor={mutedDim}>{footer ?? defaultFooter}</Text>
      </Box>
    </Box>
  );
}
