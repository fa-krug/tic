import { memo } from 'react';
import { Box, Text } from 'ink';
import type { BackendCapabilities } from '../backends/types.js';
import type { TreeItem } from './buildTree.js';

interface CardLayoutProps {
  treeItems: TreeItem[];
  cursor: number;
  capabilities: BackendCapabilities;
  collapsedIds: Set<string>;
  markedIds: Set<string>;
}

interface CardRowProps {
  treeItem: TreeItem;
  selected: boolean;
  marked: boolean;
  collapseIndicator: string;
  capabilities: BackendCapabilities;
  isLast: boolean;
}

export function formatPriority(priority: string | undefined): string {
  if (!priority) return '';
  const lower = priority.toLowerCase();
  if (lower === 'high') return '↑High';
  if (lower === 'medium' || lower === 'med') return '→Med';
  if (lower === 'low') return '↓Low';
  return priority;
}

export function formatAssignee(assignee: string | undefined): string {
  if (!assignee) return '';
  return assignee.startsWith('@') ? assignee : `@${assignee}`;
}

function statusColor(status: string): string {
  const lower = status.toLowerCase();
  if (lower === 'done' || lower === 'closed' || lower === 'resolved')
    return 'green';
  if (lower === 'in progress' || lower === 'active' || lower === 'in_progress')
    return 'yellow';
  if (lower === 'blocked') return 'red';
  return 'blue';
}

const CardRow = memo(
  function CardRow({
    treeItem,
    selected,
    marked,
    collapseIndicator,
    capabilities,
    isLast,
  }: CardRowProps) {
    const { item, depth, isCrossType } = treeItem;
    const indent = '  '.repeat(depth);
    const marker = selected ? '>' : ' ';
    const hasDeps = capabilities.fields.dependsOn && item.dependsOn.length > 0;
    const depIndicator = hasDeps ? ' ⧗' : '';
    const typeLabel = isCrossType ? ` (${item.type})` : '';
    const dimmed = isCrossType && !selected;

    // Indent for meta line: align with title start
    // marker(1) + indent + collapseIndicator(2) + '#'(1) + id + ' '(1) = offset
    const metaIndent = ' ' + indent + '  ' + ' '.repeat(item.id.length + 2);

    return (
      <Box
        flexDirection="column"
        marginBottom={isLast ? 0 : 1}
        {...(marked && !selected ? { backgroundColor: 'cyan' } : {})}
      >
        <Box>
          <Text
            color={selected ? 'cyan' : undefined}
            bold={selected}
            dimColor={dimmed}
          >
            {marker}
            {indent}
            {collapseIndicator}#{item.id} {item.title}
            {typeLabel}
            {depIndicator}
          </Text>
        </Box>
        <Box>
          <Text color={selected ? 'cyan' : undefined} dimColor={dimmed}>
            {metaIndent}
          </Text>
          <Text color={statusColor(item.status)}>●</Text>
          <Text
            color={selected ? 'cyan' : undefined}
            bold={selected}
            dimColor={dimmed}
          >
            {' '}
            {item.status}
            {capabilities.fields.priority && formatPriority(item.priority)
              ? '  ' + formatPriority(item.priority)
              : ''}
            {capabilities.fields.assignee && formatAssignee(item.assignee)
              ? '  ' + formatAssignee(item.assignee)
              : ''}
            {capabilities.fields.labels && item.labels.length > 0
              ? '  ' + item.labels.join(', ')
              : ''}
          </Text>
        </Box>
      </Box>
    );
  },
  (prev, next) => {
    if (prev.selected !== next.selected) return false;
    if (prev.marked !== next.marked) return false;
    if (prev.collapseIndicator !== next.collapseIndicator) return false;
    if (prev.capabilities !== next.capabilities) return false;
    if (prev.isLast !== next.isLast) return false;

    const prevItem = prev.treeItem.item;
    const nextItem = next.treeItem.item;
    if (prevItem.id !== nextItem.id) return false;
    if (prevItem.status !== nextItem.status) return false;
    if (prevItem.title !== nextItem.title) return false;
    if (prevItem.priority !== nextItem.priority) return false;
    if (prevItem.assignee !== nextItem.assignee) return false;
    if (prevItem.type !== nextItem.type) return false;

    if (prev.treeItem.depth !== next.treeItem.depth) return false;
    if (prev.treeItem.isCrossType !== next.treeItem.isCrossType) return false;

    // labels array — compare by joined string
    if (prevItem.labels.join(',') !== nextItem.labels.join(',')) return false;

    // dependsOn length affects the deps indicator
    if (prevItem.dependsOn.length !== nextItem.dependsOn.length) return false;

    return true;
  },
);

function CardLayoutInner({
  treeItems,
  cursor,
  capabilities,
  collapsedIds,
  markedIds,
}: CardLayoutProps) {
  if (treeItems.length === 0) return null;

  return (
    <Box flexDirection="column">
      {treeItems.map((treeItem, idx) => {
        const { item, hasChildren } = treeItem;
        const collapseIndicator = hasChildren
          ? collapsedIds.has(item.id)
            ? '▶ '
            : '▼ '
          : '  ';
        return (
          <CardRow
            key={`${item.id}-${item.type}`}
            treeItem={treeItem}
            selected={idx === cursor}
            marked={markedIds.has(item.id)}
            collapseIndicator={collapseIndicator}
            capabilities={capabilities}
            isLast={idx === treeItems.length - 1}
          />
        );
      })}
    </Box>
  );
}

export const CardLayout = memo(CardLayoutInner);
