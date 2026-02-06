import { memo, useMemo } from 'react';
import { Box, Text } from 'ink';
import type { BackendCapabilities } from '../backends/types.js';
import type { TreeItem } from './buildTree.js';

interface TableLayoutProps {
  treeItems: TreeItem[];
  cursor: number;
  capabilities: BackendCapabilities;
  collapsedIds: Set<string>;
  markedIds: Set<string>;
}

interface TableRowProps {
  treeItem: TreeItem;
  selected: boolean;
  marked: boolean;
  collapseIndicator: string;
  capabilities: BackendCapabilities;
  colId: number;
}

const colStatus = 14;
const colPriority = 10;
const colAssignee = 12;
const colLabels = 16;
const gap = 2;

const TableRow = memo(
  function TableRow({
    treeItem,
    selected,
    marked,
    collapseIndicator,
    capabilities,
    colId,
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
        <Box width={colId} overflowX="hidden">
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
        <Box width={colStatus} marginRight={gap} overflowX="hidden">
          <Text
            color={selected ? 'cyan' : undefined}
            bold={selected}
            dimColor={dimmed}
          >
            {capabilities.fields.dependsOn && hasUnresolvedDeps ? '⧗ ' : ''}
            {item.status}
          </Text>
        </Box>
        {capabilities.fields.priority && (
          <Box width={colPriority} marginRight={gap} overflowX="hidden">
            <Text
              color={selected ? 'cyan' : undefined}
              bold={selected}
              dimColor={dimmed}
            >
              {item.priority}
            </Text>
          </Box>
        )}
        {capabilities.fields.assignee && (
          <Box width={colAssignee} marginRight={gap} overflowX="hidden">
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
        {capabilities.fields.labels && (
          <Box width={colLabels} overflowX="hidden">
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
    if (prev.colId !== next.colId) return false;

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
}: TableLayoutProps) {
  const colId = useMemo(() => {
    const maxLen = treeItems.reduce(
      (max, { item }) => Math.max(max, item.id.length),
      2,
    );
    return maxLen + gap;
  }, [treeItems]);

  return (
    <>
      <Box>
        <Box width={2}>
          <Text> </Text>
        </Box>
        <Box width={colId}>
          <Text bold underline>
            ID
          </Text>
        </Box>
        <Box flexGrow={1} marginRight={gap}>
          <Text bold underline>
            Title
          </Text>
        </Box>
        <Box width={colStatus} marginRight={gap}>
          <Text bold underline>
            Status
          </Text>
        </Box>
        {capabilities.fields.priority && (
          <Box width={colPriority} marginRight={gap}>
            <Text bold underline>
              Priority
            </Text>
          </Box>
        )}
        {capabilities.fields.assignee && (
          <Box width={colAssignee} marginRight={gap}>
            <Text bold underline>
              Assignee
            </Text>
          </Box>
        )}
        {capabilities.fields.labels && (
          <Box width={colLabels}>
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
            colId={colId}
          />
        );
      })}
    </>
  );
}

export const TableLayout = memo(TableLayoutInner);
