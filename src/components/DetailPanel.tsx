import { Box, Text } from 'ink';
import type { WorkItem } from '../types.js';

function priorityColor(
  priority: string,
): 'red' | 'yellow' | 'cyan' | undefined {
  switch (priority) {
    case 'critical':
      return 'red';
    case 'high':
      return 'yellow';
    case 'medium':
      return 'cyan';
    default:
      return undefined;
  }
}

function priorityIcon(priority: string): string {
  switch (priority) {
    case 'critical':
      return '▲▲';
    case 'high':
      return '▲';
    case 'medium':
      return '●';
    case 'low':
      return '▽';
    default:
      return '';
  }
}

export function DetailPanel({
  item,
  terminalWidth,
}: {
  item: WorkItem;
  terminalWidth: number;
}) {
  const metaParts: string[] = [`#${item.id}`, item.status];
  if (item.assignee) {
    metaParts.push(`@${item.assignee}`);
  }
  const metaLine = metaParts.join('  ·  ');

  const hasBottom = item.priority || item.labels.length > 0;

  return (
    <Box
      flexDirection="column"
      marginTop={1}
      paddingLeft={1}
      width={terminalWidth}
    >
      <Box height={2}>
        <Text bold wrap="truncate">
          {item.title}
        </Text>
      </Box>
      <Box>
        <Text dimColor>{metaLine}</Text>
      </Box>
      {hasBottom && (
        <Box>
          {item.priority && (
            <Text color={priorityColor(item.priority)}>
              {priorityIcon(item.priority)} {item.priority}
            </Text>
          )}
          {item.priority && item.labels.length > 0 && (
            <Text dimColor>{'  '}</Text>
          )}
          {item.labels.length > 0 && (
            <Text dimColor>{item.labels.join(', ')}</Text>
          )}
        </Box>
      )}
    </Box>
  );
}
