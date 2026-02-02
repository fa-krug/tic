import { useMemo } from 'react';
import { Box, Text } from 'ink';
import type { BackendCapabilities } from '../backends/types.js';
import type { TreeItem } from './buildTree.js';

interface TableLayoutProps {
  treeItems: TreeItem[];
  cursor: number;
  capabilities: BackendCapabilities;
  collapsedIds: Set<string>;
}

const colStatus = 14;
const colPriority = 10;
const colAssignee = 12;
const gap = 2;

export function TableLayout({
  treeItems,
  cursor,
  capabilities,
  collapsedIds,
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
          <Box width={colAssignee}>
            <Text bold underline>
              Assignee
            </Text>
          </Box>
        )}
      </Box>

      {treeItems.map((treeItem, idx) => {
        const { item, prefix, isCrossType, hasChildren } = treeItem;
        const selected = idx === cursor;
        const hasUnresolvedDeps = item.dependsOn.length > 0;
        const collapseIndicator = hasChildren
          ? collapsedIds.has(item.id)
            ? '▶ '
            : '▼ '
          : '  ';
        const typeLabel = isCrossType ? ` (${item.type})` : '';
        const dimmed = isCrossType && !selected;
        return (
          <Box key={`${item.id}-${item.type}`}>
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
              <Box width={colAssignee} overflowX="hidden">
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
          </Box>
        );
      })}
    </>
  );
}
