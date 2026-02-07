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

export function truncateDescription(
  description: string,
  width: number,
): string {
  if (!description) return '';
  const firstLine = description.split('\n')[0]!;
  if (firstLine.length <= width) return firstLine;
  return firstLine.slice(0, width - 1) + '\u2026';
}

export function DetailPanel({
  item,
  terminalWidth,
  showFullDescription,
  descriptionScrollOffset,
  maxDescriptionHeight,
}: {
  item: WorkItem;
  terminalWidth: number;
  showFullDescription?: boolean;
  descriptionScrollOffset?: number;
  maxDescriptionHeight?: number;
}) {
  const metaParts: string[] = [`#${item.id}`, item.status];
  if (item.assignee) {
    metaParts.push(`@${item.assignee}`);
  }
  const metaLine = metaParts.join('  ·  ');

  const hasBottom = item.priority || item.labels.length > 0;
  const hasDescription = item.description.trim().length > 0;
  const contentWidth = terminalWidth - 1;

  const descriptionLines =
    hasDescription && showFullDescription ? item.description.split('\n') : [];
  const scrollOffset = descriptionScrollOffset ?? 0;
  const viewportHeight = maxDescriptionHeight ?? descriptionLines.length;
  const visibleLines = descriptionLines.slice(
    scrollOffset,
    scrollOffset + viewportHeight,
  );

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
      {hasDescription && !showFullDescription && (
        <Box>
          <Text dimColor wrap="truncate">
            {truncateDescription(item.description, contentWidth)}
          </Text>
        </Box>
      )}
      {showFullDescription && hasDescription && (
        <>
          <Box>
            <Text dimColor>
              {'─── description '}
              {'─'.repeat(Math.max(0, contentWidth - 17))}
            </Text>
          </Box>
          {visibleLines.map((line, idx) => (
            <Box key={idx}>
              <Text dimColor>{line || ' '}</Text>
            </Box>
          ))}
        </>
      )}
    </Box>
  );
}
