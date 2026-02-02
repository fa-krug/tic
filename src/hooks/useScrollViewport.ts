import { useMemo } from 'react';
import { useTerminalSize } from './useTerminalSize.js';

interface ScrollViewportOptions {
  totalItems: number;
  cursor: number;
  chromeLines: number;
  linesPerItem?: number;
}

interface ScrollViewport {
  start: number;
  end: number;
  maxVisible: number;
  visibleCursor: number;
}

export function useScrollViewport({
  totalItems,
  cursor,
  chromeLines,
  linesPerItem = 1,
}: ScrollViewportOptions): ScrollViewport {
  const { height } = useTerminalSize();
  const maxVisible = Math.max(
    1,
    Math.floor((height - chromeLines) / linesPerItem),
  );

  return useMemo(() => {
    if (totalItems <= maxVisible) {
      return { start: 0, end: totalItems, maxVisible, visibleCursor: cursor };
    }
    let start = cursor - Math.floor(maxVisible / 2);
    start = Math.max(0, Math.min(start, totalItems - maxVisible));
    return {
      start,
      end: start + maxVisible,
      maxVisible,
      visibleCursor: cursor - start,
    };
  }, [totalItems, cursor, maxVisible]);
}
