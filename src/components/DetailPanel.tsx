import { Box, Text } from 'ink';
import type { WorkItem } from '../types.js';
import { useThemeStore } from '../stores/themeStore.js';
import { useBackendDataStore } from '../stores/backendDataStore.js';
import { ColorPill } from './ColorPill.js';

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
  const { border, mutedDim } = useThemeStore((s) => s.colors);
  const pullRequests = useBackendDataStore((s) => s.pullRequests);
  const linkedPrs = pullRequests.filter((pr) =>
    pr.linkedItems.includes(item.id),
  );

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
      <Box gap={1}>
        <Text dimColor={mutedDim}>#{item.id}</Text>
        <ColorPill field="status" value={item.status} />
        <ColorPill field="type" value={item.type} />
        {item.assignee && <Text dimColor={mutedDim}>@{item.assignee}</Text>}
      </Box>
      {hasBottom && (
        <Box gap={1}>
          {item.priority && (
            <ColorPill field="priority" value={item.priority} />
          )}
          {item.labels.map((label) => (
            <ColorPill key={label} field="label" value={label} />
          ))}
        </Box>
      )}
      {linkedPrs.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Pull Requests</Text>
          {linkedPrs.map((pr) => (
            <Box key={pr.id} gap={1}>
              <Text dimColor>#{pr.number}</Text>
              <Text>{pr.title}</Text>
              <ColorPill field="status" value={pr.status} />
            </Box>
          ))}
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
