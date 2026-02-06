import { memo, useMemo } from 'react';
import { Box, Text } from 'ink';
import type { BackendCapabilities } from '../backends/types.js';
import type { TreeItem } from './buildTree.js';

interface ColumnWidths {
  id: number;
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

function computeColumnWidths(
  treeItems: TreeItem[],
  capabilities: BackendCapabilities,
  terminalWidth: number,
): ColumnWidths {
  // ID column — sized to longest visible ID
  const maxIdLen = treeItems.reduce(
    (max, { item }) => Math.max(max, item.id.length),
    2,
  );
  const id = maxIdLen + gap;

  // Status column — always shown, sized to content
  const maxStatusLen = treeItems.reduce((max, { item }) => {
    const depPrefix =
      capabilities.fields.dependsOn && item.dependsOn.length > 0 ? 2 : 0;
    return Math.max(max, item.status.length + depPrefix);
  }, 6); // min 6 for "Status" header
  const status = maxStatusLen;

  // Available space after marker, ID, title margin, status, status margin,
  // and minimum title width
  let available =
    terminalWidth - MARKER_WIDTH - id - gap - status - gap - TITLE_MIN_WIDTH;

  // Priority — try to fit
  let showPriority = false;
  let priority = 0;
  if (capabilities.fields.priority && available > 0) {
    const maxContent = treeItems.reduce(
      (max, { item }) => Math.max(max, (item.priority || '').length),
      8, // min for "Priority" header
    );
    priority = maxContent;
    if (available >= priority + gap) {
      showPriority = true;
      available -= priority + gap;
    }
  }

  // Assignee — try to fit
  let showAssignee = false;
  let assignee = 0;
  if (capabilities.fields.assignee && available > 0) {
    const maxContent = treeItems.reduce(
      (max, { item }) => Math.max(max, (item.assignee || '').length),
      8, // min for "Assignee" header
    );
    assignee = Math.min(maxContent, 20); // cap at 20
    if (available >= assignee + gap) {
      showAssignee = true;
      available -= assignee + gap;
    }
  }

  // Labels — try to fit
  let showLabels = false;
  let labels = 0;
  if (capabilities.fields.labels && available > 0) {
    const maxContent = treeItems.reduce(
      (max, { item }) => Math.max(max, item.labels.join(', ').length),
      6, // min for "Labels" header
    );
    labels = Math.min(maxContent, 24); // cap at 24
    if (available >= labels) {
      showLabels = true;
    }
  }

  return {
    id,
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
        <Box flexGrow={1} marginRight={gap} overflowX="hidden">
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
          >
            {capabilities.fields.dependsOn && hasUnresolvedDeps ? '⧗ ' : ''}
            {item.status}
          </Text>
        </Box>
        {columns.showPriority && (
          <Box width={columns.priority} marginRight={gap} overflowX="hidden">
            <Text
              color={selected ? 'cyan' : undefined}
              bold={selected}
              dimColor={dimmed}
            >
              {item.priority}
            </Text>
          </Box>
        )}
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
          <Box width={columns.labels} overflowX="hidden">
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
        <Box flexGrow={1} marginRight={gap}>
          <Text bold underline>
            Title
          </Text>
        </Box>
        <Box width={columns.status} marginRight={gap}>
          <Text bold underline>
            Status
          </Text>
        </Box>
        {columns.showPriority && (
          <Box width={columns.priority} marginRight={gap}>
            <Text bold underline>
              Priority
            </Text>
          </Box>
        )}
        {columns.showAssignee && (
          <Box width={columns.assignee} marginRight={gap}>
            <Text bold underline>
              Assignee
            </Text>
          </Box>
        )}
        {columns.showLabels && (
          <Box width={columns.labels}>
            <Text bold underline>
              Labels
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
