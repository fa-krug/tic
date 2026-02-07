import { memo, useMemo } from 'react';
import { Box, Text } from 'ink';
import type { BackendCapabilities } from '../backends/types.js';
import type { TreeItem } from './buildTree.js';

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
}

interface TableLayoutProps {
  treeItems: TreeItem[];
  cursor: number;
  capabilities: BackendCapabilities;
  collapsedIds: Set<string>;
  markedIds: Set<string>;
  terminalWidth: number;
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
const TITLE_MIN_WIDTH = 20;

const FIXED_STATUS = 10;
const FIXED_PRIORITY = 10;
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

  // Fixed-width columns, removed right-to-left if title would drop below min
  const status = FIXED_STATUS;

  // Budget = total - marker - id - title_min - status - gaps(title+status)
  let budget =
    terminalWidth - MARKER_WIDTH - id - TITLE_MIN_WIDTH - status - gap * 2;

  // Try adding optional columns (right-to-left removal order: priority, labels, assignee)
  // Priority is rightmost — its width is NOT subtracted from title, giving title more space
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

  const showPriority =
    capabilities.fields.priority && hasData(treeItems, 'priority');
  const priority = showPriority ? FIXED_PRIORITY : 0;

  return {
    id,
    title:
      terminalWidth -
      MARKER_WIDTH -
      id -
      status -
      gap * 2 -
      (showAssignee ? assignee + gap : 0) -
      (showLabels ? labels + gap : 0),
    status,
    priority,
    assignee,
    labels,
    showPriority,
    showAssignee,
    showLabels,
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
    const { item, prefix, isCrossType } = treeItem;
    const hasUnresolvedDeps = item.dependsOn.length > 0;
    const typeLabel = isCrossType ? ` (${item.type})` : '';
    const dimmed = isCrossType && !selected;
    return (
      <Box {...(marked && !selected ? { backgroundColor: 'cyan' } : {})}>
        <Box width={2}>
          <Text color="cyan">{selected ? '>' : ' '}</Text>
        </Box>
        <Box width={columns.id} overflowX="hidden">
          <Text
            color={selected ? 'cyan' : undefined}
            bold={selected}
            dimColor={dimmed}
          >
            {item.id}
          </Text>
        </Box>
        <Box width={columns.title} marginRight={gap} overflowX="hidden">
          <Text
            color={selected ? 'cyan' : undefined}
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
        <Box width={columns.status} marginRight={gap} overflowX="hidden">
          <Text
            color={selected ? 'cyan' : undefined}
            bold={selected}
            dimColor={dimmed}
            wrap="truncate"
          >
            {capabilities.fields.dependsOn && hasUnresolvedDeps ? '⧗ ' : ''}
            {item.status}
          </Text>
        </Box>
        {columns.showAssignee && (
          <Box width={columns.assignee} marginRight={gap} overflowX="hidden">
            <Text
              color={selected ? 'cyan' : undefined}
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
            <Text
              color={selected ? 'cyan' : undefined}
              bold={selected}
              dimColor={dimmed}
              wrap="truncate"
            >
              {item.labels.join(', ')}
            </Text>
          </Box>
        )}
        {columns.showPriority && (
          <Box width={columns.priority} overflowX="hidden">
            <Text
              color={selected ? 'cyan' : undefined}
              bold={selected}
              dimColor={dimmed}
              wrap="truncate"
            >
              {item.priority}
            </Text>
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

function TableLayoutInner({
  treeItems,
  cursor,
  capabilities,
  collapsedIds,
  markedIds,
  terminalWidth,
}: TableLayoutProps) {
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
            ID
          </Text>
        </Box>
        <Box width={columns.title} marginRight={gap}>
          <Text bold underline>
            Title
          </Text>
        </Box>
        <Box width={columns.status} marginRight={gap}>
          <Text bold underline>
            Status
          </Text>
        </Box>
        {columns.showAssignee && (
          <Box width={columns.assignee} marginRight={gap}>
            <Text bold underline>
              Assignee
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
              Priority
            </Text>
          </Box>
        )}
      </Box>

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
