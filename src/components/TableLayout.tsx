import { memo, useMemo } from 'react';
import { Box, Text } from 'ink';
import type { BackendCapabilities } from '../backends/types.js';
import type { TreeItem } from './buildTree.js';
import type { SortEntry } from '../stores/listViewStore.js';
import { useThemeStore } from '../stores/themeStore.js';
import { ColorPill } from './ColorPill.js';

interface ColumnWidths {
  id: number;
  title: number;
  status: number;
  priority: number;
  assignee: number;
  labels: number;
  showPriority: boolean;
  showAssignee: boolean;
  showLabels: boolean;
  showStatus: boolean;
}

interface TableLayoutProps {
  treeItems: TreeItem[];
  cursor: number;
  capabilities: BackendCapabilities;
  collapsedIds: Set<string>;
  markedIds: Set<string>;
  terminalWidth: number;
  sortStack?: SortEntry[];
}

interface TableRowProps {
  treeItem: TreeItem;
  selected: boolean;
  marked: boolean;
  collapseIndicator: string;
  capabilities: BackendCapabilities;
  columns: ColumnWidths;
}

const gap = 2;
const MARKER_WIDTH = 2;
const TITLE_MIN_WIDTH = 30;

const FIXED_STATUS = 12;
const FIXED_PRIORITY = 12;
const FIXED_ASSIGNEE = 20;
const FIXED_LABELS = 20;

function hasData(
  treeItems: TreeItem[],
  field: 'priority' | 'assignee' | 'labels',
): boolean {
  return treeItems.some(({ item }) => {
    if (field === 'labels') return item.labels.length > 0;
    return !!item[field];
  });
}

function computeColumnWidths(
  treeItems: TreeItem[],
  capabilities: BackendCapabilities,
  terminalWidth: number,
): ColumnWidths {
  // ID column — sized to longest visible ID + gap
  const maxIdLen = treeItems.reduce(
    (max, { item }) => Math.max(max, item.id.length),
    2,
  );
  const id = maxIdLen + gap;

  // Start with mandatory columns: marker + id + title_min + gap(title)
  // Budget = remaining space for optional columns (status, assignee, labels, priority)
  let budget = terminalWidth - MARKER_WIDTH - id - TITLE_MIN_WIDTH - gap;

  // Try adding optional columns; removal order when narrow: priority, labels, status
  // Assignee is kept as long as status is shown (they share the same budget tier)
  let showAssignee = false;
  let assignee = 0;
  if (
    capabilities.fields.assignee &&
    hasData(treeItems, 'assignee') &&
    budget >= FIXED_ASSIGNEE + gap
  ) {
    showAssignee = true;
    assignee = FIXED_ASSIGNEE;
    budget -= assignee + gap;
  }

  let showStatus = false;
  const status = FIXED_STATUS;
  if (budget >= status + gap) {
    showStatus = true;
    budget -= status + gap;
  }

  let showLabels = false;
  let labels = 0;
  if (
    capabilities.fields.labels &&
    hasData(treeItems, 'labels') &&
    budget >= FIXED_LABELS + gap
  ) {
    showLabels = true;
    labels = FIXED_LABELS;
    budget -= labels + gap;
  }

  let showPriority = false;
  let priority = 0;
  if (
    capabilities.fields.priority &&
    hasData(treeItems, 'priority') &&
    budget >= FIXED_PRIORITY
  ) {
    showPriority = true;
    priority = FIXED_PRIORITY;
  }

  // Title gets all remaining space after fixed columns
  const titleWidth =
    terminalWidth -
    MARKER_WIDTH -
    id -
    gap -
    (showStatus ? status + gap : 0) -
    (showAssignee ? assignee + gap : 0) -
    (showLabels ? labels + gap : 0) -
    (showPriority ? priority : 0);

  return {
    id,
    title: titleWidth,
    status,
    priority,
    assignee,
    labels,
    showPriority,
    showAssignee,
    showLabels,
    showStatus,
  };
}

const TableRow = memo(
  function TableRow({
    treeItem,
    selected,
    marked,
    collapseIndicator,
    capabilities,
    columns,
  }: TableRowProps) {
    const { accent, accentBg } = useThemeStore((s) => s.colors);
    const { item, prefix, isCrossType } = treeItem;
    const hasUnresolvedDeps = item.dependsOn.length > 0;
    const typeLabel = isCrossType ? ` (${item.type})` : '';
    const dimmed = isCrossType && !selected;
    return (
      <Box {...(marked && !selected ? { backgroundColor: accentBg } : {})}>
        <Box width={2}>
          <Text color={accent}>{selected ? '>' : ' '}</Text>
        </Box>
        <Box width={columns.id} overflowX="hidden">
          <Text
            color={selected ? accent : undefined}
            bold={selected}
            dimColor={dimmed}
          >
            {item.id}
          </Text>
        </Box>
        <Box width={columns.title} marginRight={gap} overflowX="hidden">
          <Text
            color={selected ? accent : undefined}
            bold={selected}
            dimColor={dimmed}
            wrap="truncate"
          >
            {capabilities.relationships ? prefix : ''}
            {collapseIndicator}
            {item.title}
            {typeLabel}
          </Text>
        </Box>
        {columns.showStatus && (
          <Box width={columns.status} marginRight={gap} overflowX="hidden">
            {capabilities.fields.dependsOn && hasUnresolvedDeps && (
              <Text dimColor={dimmed}>⧗ </Text>
            )}
            <ColorPill field="status" value={item.status} />
          </Box>
        )}
        {columns.showAssignee && (
          <Box width={columns.assignee} marginRight={gap} overflowX="hidden">
            <Text
              color={selected ? accent : undefined}
              bold={selected}
              dimColor={dimmed}
              wrap="truncate"
            >
              {item.assignee}
            </Text>
          </Box>
        )}
        {columns.showLabels && (
          <Box
            width={columns.labels}
            marginRight={columns.showPriority ? gap : 0}
            overflowX="hidden"
          >
            {(() => {
              const maxWidth = columns.labels;
              const rendered: string[] = [];
              let usedWidth = 0;
              for (const label of item.labels) {
                // Each pill takes label.length + 2 (padding), plus 1 gap between pills
                const pillWidth = label.length + 2;
                const needed = usedWidth === 0 ? pillWidth : pillWidth + 1;
                if (usedWidth + needed > maxWidth) {
                  const remaining = item.labels.length - rendered.length;
                  if (remaining > 0) {
                    return (
                      <Box gap={1}>
                        {rendered.map((l) => (
                          <ColorPill key={l} field="label" value={l} />
                        ))}
                        <Text dimColor>+{remaining}</Text>
                      </Box>
                    );
                  }
                  break;
                }
                rendered.push(label);
                usedWidth += needed;
              }
              return (
                <Box gap={1}>
                  {rendered.map((l) => (
                    <ColorPill key={l} field="label" value={l} />
                  ))}
                </Box>
              );
            })()}
          </Box>
        )}
        {columns.showPriority && (
          <Box width={columns.priority} overflowX="hidden">
            {item.priority ? (
              <ColorPill field="priority" value={item.priority} />
            ) : (
              <Text> </Text>
            )}
          </Box>
        )}
      </Box>
    );
  },
  (prev, next) => {
    if (prev.selected !== next.selected) return false;
    if (prev.marked !== next.marked) return false;
    if (prev.collapseIndicator !== next.collapseIndicator) return false;
    if (prev.capabilities !== next.capabilities) return false;
    if (prev.columns !== next.columns) return false;

    const prevItem = prev.treeItem.item;
    const nextItem = next.treeItem.item;
    if (prevItem.id !== nextItem.id) return false;
    if (prevItem.status !== nextItem.status) return false;
    if (prevItem.title !== nextItem.title) return false;
    if (prevItem.priority !== nextItem.priority) return false;
    if (prevItem.assignee !== nextItem.assignee) return false;

    if (prev.treeItem.prefix !== next.treeItem.prefix) return false;
    if (prev.treeItem.isCrossType !== next.treeItem.isCrossType) return false;

    // labels array — compare by joined string
    if (prevItem.labels.join(',') !== nextItem.labels.join(',')) return false;

    // dependsOn length affects the deps indicator
    if (prevItem.dependsOn.length !== nextItem.dependsOn.length) return false;

    // item.type affects typeLabel for cross-type items
    if (prevItem.type !== nextItem.type) return false;

    return true;
  },
);

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

function TableLayoutInner({
  treeItems,
  cursor,
  capabilities,
  collapsedIds,
  markedIds,
  terminalWidth,
  sortStack,
}: TableLayoutProps) {
  const { mutedDim } = useThemeStore((s) => s.colors);
  const ss = sortStack ?? [];
  const columns = useMemo(
    () => computeColumnWidths(treeItems, capabilities, terminalWidth),
    [treeItems, capabilities, terminalWidth],
  );

  return (
    <>
      <Box>
        <Box width={2}>
          <Text> </Text>
        </Box>
        <Box width={columns.id}>
          <Text bold underline>
            {sortedHeaderLabel('ID', 'id', ss)}
          </Text>
        </Box>
        <Box width={columns.title} marginRight={gap}>
          <Text bold underline>
            {sortedHeaderLabel('Title', 'title', ss)}
          </Text>
        </Box>
        {columns.showStatus && (
          <Box width={columns.status} marginRight={gap}>
            <Text bold underline>
              {sortedHeaderLabel('Status', 'status', ss)}
            </Text>
          </Box>
        )}
        {columns.showAssignee && (
          <Box width={columns.assignee} marginRight={gap}>
            <Text bold underline>
              {sortedHeaderLabel('Assignee', 'assignee', ss)}
            </Text>
          </Box>
        )}
        {columns.showLabels && (
          <Box
            width={columns.labels}
            marginRight={columns.showPriority ? gap : 0}
          >
            <Text bold underline>
              Labels
            </Text>
          </Box>
        )}
        {columns.showPriority && (
          <Box width={columns.priority}>
            <Text bold underline>
              {sortedHeaderLabel('Priority', 'priority', ss)}
            </Text>
          </Box>
        )}
      </Box>

      {(() => {
        const nonVisibleSorts = ss.filter(
          (e) => e.column === 'created' || e.column === 'updated',
        );
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

      {treeItems.map((treeItem, idx) => {
        const { item, hasChildren } = treeItem;
        const collapseIndicator = hasChildren
          ? collapsedIds.has(item.id)
            ? '▶ '
            : '▼ '
          : '  ';
        return (
          <TableRow
            key={`${item.id}-${item.type}`}
            treeItem={treeItem}
            selected={idx === cursor}
            marked={markedIds.has(item.id)}
            collapseIndicator={collapseIndicator}
            capabilities={capabilities}
            columns={columns}
          />
        );
      })}
    </>
  );
}

export const TableLayout = memo(TableLayoutInner);
