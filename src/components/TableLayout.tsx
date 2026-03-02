import { memo, useMemo } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Box, Text } from 'ink';
import type { SortEntry } from '../stores/listViewStore.js';
import { useThemeStore, autoFg } from '../stores/themeStore.js';

export interface ColumnDef<T> {
  key: string;
  header: string;
  /** Fixed width in chars. Use -1 for flex column (gets remaining space). */
  width: number;
  render: (item: T, selected: boolean) => ReactNode;
  /** If true, column is never hidden responsively. Default false. */
  required?: boolean;
  /** Higher number = kept longer when space is tight. Default 0. */
  hidePriority?: number;
  /** Return true if any item has data for this column. If false, column is skipped entirely. */
  hasData?: (items: T[]) => boolean;
  /** Show sort indicator in header when sortStack includes this key. */
  sortable?: boolean;
}

export interface TableLayoutProps<T> {
  items: T[];
  columns: ColumnDef<T>[];
  cursor: number;
  terminalWidth: number;
  getKey: (item: T) => string;
  /** Show '>' marker column. Default true. */
  showMarker?: boolean;
  /** Whether this item is marked for bulk operations. */
  isMarked?: (item: T) => boolean;
  /** Multi-column sort state for header indicators. */
  sortStack?: SortEntry[];
}

interface ComputedColumn {
  key: string;
  header: string;
  width: number;
  visible: boolean;
  sortable: boolean;
}

const gap = 2;
const MARKER_WIDTH = 2;
const TITLE_MIN_WIDTH = 30;

function computeVisibleColumns<T>(
  columns: ColumnDef<T>[],
  items: T[],
  terminalWidth: number,
  showMarker: boolean,
): ComputedColumn[] {
  const markerWidth = showMarker ? MARKER_WIDTH : 0;

  // Find the flex column (width === -1)
  const flexIndex = columns.findIndex((c) => c.width === -1);

  // Start by computing required columns and their fixed widths
  const result: ComputedColumn[] = columns.map((col) => ({
    key: col.key,
    header: col.header,
    width: col.width === -1 ? 0 : col.width,
    visible: false,
    sortable: col.sortable ?? false,
  }));

  // Always show required columns
  let usedWidth = markerWidth;
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i]!;
    if (col.required) {
      result[i]!.visible = true;
      if (col.width !== -1) {
        usedWidth += col.width + gap;
      }
    }
  }

  // Sort optional columns by descending hidePriority
  const optionalIndices = columns
    .map((col, i) => ({ col, i }))
    .filter(({ col }) => !col.required && col.width !== -1)
    .sort((a, b) => (b.col.hidePriority ?? 0) - (a.col.hidePriority ?? 0));

  // Try to fit optional columns
  for (const { col, i } of optionalIndices) {
    // Skip if hasData returns false
    if (col.hasData && !col.hasData(items)) continue;

    const needed = col.width + gap;
    if (
      usedWidth + needed + TITLE_MIN_WIDTH <= terminalWidth ||
      flexIndex === -1
    ) {
      result[i]!.visible = true;
      usedWidth += needed;
    }
  }

  // Flex column gets remaining space
  if (flexIndex !== -1) {
    const flexWidth = Math.max(TITLE_MIN_WIDTH, terminalWidth - usedWidth);
    result[flexIndex]!.width = flexWidth;
    result[flexIndex]!.visible = true;
  }

  return result;
}

interface GenericTableRowProps<T> {
  item: T;
  selected: boolean;
  marked: boolean;
  columns: ColumnDef<T>[];
  computedColumns: ComputedColumn[];
  showMarker: boolean;
}

const GenericTableRow = memo(function GenericTableRow<T>({
  item,
  selected,
  marked,
  columns,
  computedColumns,
  showMarker,
}: GenericTableRowProps<T>) {
  const { accent, accentBg, selectionBg, selectedMarkedBg } = useThemeStore(
    (s) => s.colors,
  );
  return (
    <Box
      backgroundColor={
        selected && marked
          ? selectedMarkedBg
          : selected
            ? selectionBg
            : marked
              ? accentBg
              : undefined
      }
    >
      {showMarker && (
        <Box width={MARKER_WIDTH}>
          <Text color={selected ? autoFg(selectionBg) : accent}>
            {selected ? '>' : ' '}
          </Text>
        </Box>
      )}
      {computedColumns.map((cc, i) => {
        if (!cc.visible) return null;
        const colDef = columns[i]!;
        const lastVisibleIndex = computedColumns.findLastIndex(
          (c) => c.visible,
        );
        const isLast = i === lastVisibleIndex;
        return (
          <Box
            key={cc.key}
            width={cc.width}
            marginRight={isLast ? 0 : gap}
            overflowX="hidden"
          >
            {colDef.render(item, selected)}
          </Box>
        );
      })}
    </Box>
  );
}) as <T>(props: GenericTableRowProps<T>) => ReactElement;

function sortedHeaderLabel(
  baseLabel: string,
  column: string,
  sortStack: SortEntry[],
): string {
  const idx = sortStack.findIndex((e) => e.column === column);
  if (idx === -1) return baseLabel;
  const entry = sortStack[idx]!;
  const arrow = entry.direction === 'asc' ? '\u25B2' : '\u25BC';
  const pos = sortStack.length > 1 ? `${idx + 1}` : '';
  return `${baseLabel} ${pos}${arrow}`;
}

function TableLayoutInner<T>({
  items,
  columns,
  cursor,
  terminalWidth,
  getKey,
  showMarker = true,
  isMarked,
  sortStack,
}: TableLayoutProps<T>) {
  const { mutedDim } = useThemeStore((s) => s.colors);
  const ss = sortStack ?? [];
  const computedColumns = useMemo(
    () => computeVisibleColumns(columns, items, terminalWidth, showMarker),
    [columns, items, terminalWidth, showMarker],
  );

  return (
    <>
      <Box>
        {showMarker && (
          <Box width={MARKER_WIDTH}>
            <Text> </Text>
          </Box>
        )}
        {computedColumns.map((cc, i) => {
          if (!cc.visible) return null;
          const lastVisibleIndex = computedColumns.findLastIndex(
            (c) => c.visible,
          );
          const isLast = i === lastVisibleIndex;
          return (
            <Box key={cc.key} width={cc.width} marginRight={isLast ? 0 : gap}>
              <Text bold underline>
                {cc.sortable
                  ? sortedHeaderLabel(cc.header, cc.key, ss)
                  : cc.header}
              </Text>
            </Box>
          );
        })}
      </Box>

      {(() => {
        const visibleKeys = new Set(
          computedColumns.filter((c) => c.visible).map((c) => c.key),
        );
        const nonVisibleSorts = ss.filter((e) => !visibleKeys.has(e.column));
        if (nonVisibleSorts.length === 0) return null;
        const parts = nonVisibleSorts.map((e) => {
          const idx = ss.indexOf(e);
          const arrow = e.direction === 'asc' ? '\u25B2' : '\u25BC';
          const pos = ss.length > 1 ? `${idx + 1}` : '';
          const label = e.column.charAt(0).toUpperCase() + e.column.slice(1);
          return `${label} ${pos}${arrow}`;
        });
        return (
          <Box>
            <Text dimColor={mutedDim}>Sorted by: {parts.join(', ')}</Text>
          </Box>
        );
      })()}

      {items.map((item, idx) => (
        <GenericTableRow
          key={getKey(item)}
          item={item}
          selected={idx === cursor}
          marked={isMarked ? isMarked(item) : false}
          columns={columns}
          computedColumns={computedColumns}
          showMarker={showMarker}
        />
      ))}
    </>
  );
}

export const TableLayout = memo(TableLayoutInner) as <T>(
  props: TableLayoutProps<T>,
) => ReactElement;
