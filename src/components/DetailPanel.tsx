import { Box, Text } from 'ink';
import type { WorkItem } from '../types.js';
import { useThemeStore } from '../stores/themeStore.js';
import { useBackendDataStore } from '../stores/backendDataStore.js';
import { ColorPill } from './ColorPill.js';
import {
  computeLineContexts,
  highlightLine,
  highlightSlice,
} from './markdownHighlight.js';

/** Word-wrap a single line into segments that fit within `width`. */
export function wrapLine(
  line: string,
  width: number,
): { start: number; end: number }[] {
  if (width <= 0 || line.length <= width) {
    return [{ start: 0, end: line.length }];
  }

  const segments: { start: number; end: number }[] = [];
  let pos = 0;

  while (pos < line.length) {
    if (pos + width >= line.length) {
      segments.push({ start: pos, end: line.length });
      break;
    }

    // Find last space within width to break at a word boundary
    const spaceIdx = line.lastIndexOf(' ', pos + width);
    let breakAt: number;
    if (spaceIdx > pos) {
      breakAt = spaceIdx + 1; // break after the space
    } else {
      // No space found — hard break
      breakAt = pos + width;
    }

    segments.push({ start: pos, end: breakAt });
    pos = breakAt;
  }

  return segments;
}

/** Count total visual lines after word-wrapping all lines to `width`. */
export function countWrappedLines(lines: string[], width: number): number {
  let total = 0;
  for (const line of lines) {
    total += wrapLine(line, width).length;
  }
  return total;
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
  const { border, mutedDim } = useThemeStore((s) => s.colors);
  const pullRequests = useBackendDataStore((s) => s.pullRequests);
  const linkedPrs = pullRequests.filter((pr) =>
    pr.linkedItems.includes(item.rowId),
  );

  const hasBottom = item.priority || item.labels.length > 0;
  const hasDescription = item.description.trim().length > 0;
  // Border takes 2 chars (left+right), paddingLeft + paddingRight take 2
  const contentWidth = terminalWidth - 4;

  const descriptionLines =
    hasDescription && showFullDescription ? item.description.split('\n') : [];
  const lineContexts = descriptionLines.length
    ? computeLineContexts(descriptionLines)
    : [];

  // Pre-compute wrapped visual lines with references back to source
  const wrappedRows: {
    line: string;
    context: ReturnType<typeof computeLineContexts>[number];
    start: number;
    end: number;
  }[] = [];
  for (let i = 0; i < descriptionLines.length; i++) {
    const segments = wrapLine(descriptionLines[i]!, contentWidth);
    for (const seg of segments) {
      wrappedRows.push({
        line: descriptionLines[i]!,
        context: lineContexts[i]!,
        start: seg.start,
        end: seg.end,
      });
    }
  }

  const scrollOffset = descriptionScrollOffset ?? 0;
  const viewportHeight = maxDescriptionHeight ?? wrappedRows.length;
  const visibleRows = wrappedRows.slice(
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
        <Text dimColor={mutedDim}>#{item.id ?? '\u00B7'}</Text>
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
        <Box marginTop={1}>
          <Text dimColor={mutedDim} wrap="truncate">
            {truncateDescription(item.description, contentWidth)}
          </Text>
        </Box>
      )}
      {showFullDescription && hasDescription && (
        <Box flexDirection="column" marginTop={1}>
          {visibleRows.map((row, idx) => (
            <Box key={idx}>
              {row.start === 0 && row.end === row.line.length
                ? highlightLine(row.line, row.context)
                : highlightSlice(row.line, row.start, row.end, row.context)}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
