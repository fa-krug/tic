import { Box, Text } from 'ink';
import type { BackendCapabilities } from '../backends/types.js';
import type { TreeItem } from './buildTree.js';

interface CardLayoutProps {
  treeItems: TreeItem[];
  cursor: number;
  capabilities: BackendCapabilities;
  collapsedIds: Set<string>;
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

export function CardLayout({
  treeItems,
  cursor,
  capabilities,
  collapsedIds,
}: CardLayoutProps) {
  if (treeItems.length === 0) return null;

  return (
    <Box flexDirection="column">
      {treeItems.map((treeItem, idx) => {
        const { item, depth, isCrossType, hasChildren } = treeItem;
        const selected = idx === cursor;
        const indent = '  '.repeat(depth);
        const marker = selected ? '>' : ' ';
        const hasDeps =
          capabilities.fields.dependsOn && item.dependsOn.length > 0;
        const depIndicator = hasDeps ? ' ⧗' : '';
        const collapseIndicator = hasChildren
          ? collapsedIds.has(item.id)
            ? '▶ '
            : '▼ '
          : '  ';
        const typeLabel = isCrossType ? ` (${item.type})` : '';
        const dimmed = isCrossType && !selected;

        // Indent for meta line: align with title start
        // marker(1) + indent + collapseIndicator(2) + '#'(1) + id + ' '(1) = offset
        const metaIndent = ' ' + indent + '  ' + ' '.repeat(item.id.length + 2);

        return (
          <Box
            key={`${item.id}-${item.type}`}
            flexDirection="column"
            marginBottom={idx < treeItems.length - 1 ? 1 : 0}
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
              </Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
