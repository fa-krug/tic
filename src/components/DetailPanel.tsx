import { Box, Text } from 'ink';
import type { WorkItem } from '../types.js';
import { useThemeStore } from '../stores/themeStore.js';

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
  const { error, warning, info, border, mutedDim } = useThemeStore(
    (s) => s.colors,
  );

  function priorityColor(priority: string): string | undefined {
    switch (priority) {
      case 'critical':
        return error;
      case 'high':
        return warning;
      case 'medium':
        return info;
      default:
        return undefined;
    }
  }

  const metaParts: string[] = [`#${item.id}`, item.status];
  if (item.assignee) {
    metaParts.push(`@${item.assignee}`);
  }
  const metaLine = metaParts.join('  ·  ');

  const hasBottom = item.priority || item.labels.length > 0;
  const hasDescription = item.description.trim().length > 0;
  // Border takes 2 chars (left+right), paddingLeft takes 1
  const contentWidth = terminalWidth - 3;

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
      borderStyle="round"
      borderColor={border}
      paddingLeft={1}
      paddingRight={1}
      width={terminalWidth}
    >
      <Text bold wrap="truncate">
        {item.title}
      </Text>
      <Box>
        <Text dimColor={mutedDim}>{metaLine}</Text>
      </Box>
      {hasBottom && (
        <Box>
          {item.priority && (
            <Text color={priorityColor(item.priority)}>
              {priorityIcon(item.priority)} {item.priority}
            </Text>
          )}
          {item.priority && item.labels.length > 0 && (
            <Text dimColor={mutedDim}>{'  '}</Text>
          )}
          {item.labels.length > 0 && (
            <Text dimColor={mutedDim}>{item.labels.join(', ')}</Text>
          )}
        </Box>
      )}
      {hasDescription && !showFullDescription && (
        <Box>
          <Text dimColor={mutedDim} wrap="truncate">
            {truncateDescription(item.description, contentWidth)}
          </Text>
        </Box>
      )}
      {showFullDescription && hasDescription && (
        <>
          <Box>
            <Text dimColor={mutedDim}>
              {'─── description '}
              {'─'.repeat(Math.max(0, contentWidth - 17))}
            </Text>
          </Box>
          {visibleLines.map((line, idx) => (
            <Box key={idx}>
              <Text dimColor={mutedDim}>{line || ' '}</Text>
            </Box>
          ))}
        </>
      )}
    </Box>
  );
}
