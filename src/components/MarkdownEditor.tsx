import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from 'react';
import { Box, Text, useInput, useStdin } from 'ink';
import {
  editorStore,
  useEditorStore,
  computeScrollOffset,
  computeVisibleLines,
} from '../stores/editorStore.js';
import { formStackStore, useFormStackStore } from '../stores/formStackStore.js';
import { navigationStore, type Screen } from '../stores/navigationStore.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import {
  highlightLine,
  highlightLineWithCursor,
  highlightSlice,
  highlightSliceWithCursor,
  computeLineContexts,
  type LineContext,
} from './markdownHighlight.js';
import { useThemeStore } from '../stores/themeStore.js';
import { readClipboardImage, ClipboardError } from '../clipboard.js';
import { getImageUploadBackend } from '../stores/backendDataStore.js';
import { uiStore } from '../stores/uiStore.js';
import { useForwardDelete } from '../hooks/useForwardDelete.js';
import { useMouseScroll, usePageKeys } from '../hooks/useMouseScroll.js';

export function MarkdownEditor() {
  const lines = useEditorStore((s) => s.lines);
  const cursor = useEditorStore((s) => s.cursor);
  const scrollOffset = useEditorStore((s) => s.scrollOffset);
  const dirty = useEditorStore((s) => s.dirty);
  const showDiscardPrompt = useEditorStore((s) => s.showDiscardPrompt);
  const uploadStatus = useEditorStore((s) => s.uploadStatus);
  const draft = useFormStackStore((s) => s.currentDraft());
  const { height, width: terminalWidth } = useTerminalSize();
  const accent = useThemeStore((s) => s.colors.accent);
  const viewportHeight = height - 2; // status bar + help bar
  const isForwardDeleteRef = useForwardDelete();
  const pageKeysRef = usePageKeys();

  // Suppress key events that are actually mouse SGR sequences (clicks,
  // drags, wheel). Without this, clicking inside the editor inserts the
  // raw escape sequence as text and triggers the discard prompt.
  const { internal_eventEmitter } = useStdin();
  const mouseActivityRef = useRef(0);
  useEffect(() => {
    const handler = (data: string) => {
      // SGR mouse: ESC[<B;X;Y(M|m); legacy x10: ESC[M...
      // eslint-disable-next-line no-control-regex
      if (/\x1b\[<\d+;\d+;\d+[Mm]/.test(data) || /\x1b\[M/.test(data)) {
        mouseActivityRef.current = Date.now();
      }
    };
    internal_eventEmitter?.on('input', handler);
    return () => {
      internal_eventEmitter?.removeListener('input', handler);
    };
  }, [internal_eventEmitter]);
  const gutterDigits = Math.max(2, String(lines.length).length);
  const gutterWidth = gutterDigits + 1; // digits + trailing space
  const contentWidth = Math.max(1, terminalWidth - gutterWidth);

  // Mouse wheel scrolling
  useMouseScroll(
    useCallback(
      (direction: 'up' | 'down') => {
        const SCROLL_LINES = 3;
        editorStore.setState((s) => {
          let totalVisualLines = 0;
          for (const l of s.lines) {
            totalVisualLines +=
              contentWidth > 0 && l.length > 0
                ? Math.ceil(l.length / contentWidth)
                : 1;
          }
          const maxScroll = Math.max(0, totalVisualLines - viewportHeight);
          const newOffset =
            direction === 'up'
              ? Math.max(0, s.scrollOffset - SCROLL_LINES)
              : Math.min(maxScroll, s.scrollOffset + SCROLL_LINES);
          return { scrollOffset: newOffset };
        });
      },
      [viewportHeight, contentWidth],
    ),
  );

  // Keep scroll in sync with cursor (useLayoutEffect to update before paint)
  useLayoutEffect(() => {
    editorStore.getState().updateScroll(viewportHeight, contentWidth);
  }, [
    cursor.row,
    cursor.col,
    lines.length,
    viewportHeight,
    contentWidth,
    scrollOffset,
  ]);

  useInput((input, key) => {
    // If a mouse event arrived in the same tick, swallow whatever Ink
    // emitted from that escape sequence (could be `key.escape` for the
    // leading ESC and/or the rest of the sequence as `input`).
    if (Date.now() - mouseActivityRef.current < 50) return;

    const s = editorStore.getState();
    const returnScreen = (s.returnScreen ?? 'form') as Screen;

    // Discard prompt mode — only handle d and escape
    if (showDiscardPrompt) {
      if (input === 'd') {
        s.destroy();
        navigationStore.getState().navigate(returnScreen);
      }
      if (key.escape) {
        editorStore.setState({ showDiscardPrompt: false });
      }
      return;
    }

    // Save: Ctrl+S
    if (input === 's' && key.ctrl) {
      const content = s.getContent();
      if (s.onSave) {
        s.onSave(content);
      } else {
        formStackStore.getState().updateFields({ description: content });
      }
      s.destroy();
      navigationStore.getState().navigate(returnScreen);
      return;
    }

    // Cancel: Escape
    if (key.escape) {
      if (s.dirty) {
        editorStore.setState({ showDiscardPrompt: true });
      } else {
        s.destroy();
        navigationStore.getState().navigate(returnScreen);
      }
      return;
    }

    // Undo/Redo
    if (input === 'z' && key.ctrl) {
      s.undo();
      return;
    }
    // Ctrl+Shift+Z may come through as key.ctrl with input 'Z' (capital)
    if (input === 'Z' && key.ctrl) {
      s.redo();
      return;
    }

    // Paste image: Ctrl+V
    if (input === 'v' && key.ctrl) {
      let imageData: Buffer | null;
      try {
        imageData = readClipboardImage();
      } catch (err) {
        if (err instanceof ClipboardError) {
          uiStore.getState().setToast(err.message);
        }
        return;
      }
      if (!imageData) {
        uiStore.getState().setToast('No image found in clipboard');
        return;
      }

      const uploader = getImageUploadBackend();
      if (!uploader) {
        uiStore.getState().setToast('Image upload not available');
        return;
      }

      if (s.uploadStatus) {
        uiStore.getState().setToast('Upload already in progress');
        return;
      }

      editorStore.setState({ uploadStatus: 'Uploading image...' });
      const hash = Date.now().toString(36);
      const filename = `paste-${hash}.png`;
      void uploader.uploadImage(imageData, filename).then(
        (relPath) => {
          s.insertText(`![image](${relPath})`);
          editorStore.setState({ uploadStatus: null });
          uiStore.getState().setToast('Image saved');
        },
        (err: unknown) => {
          editorStore.setState({ uploadStatus: null });
          const msg = err instanceof Error ? err.message : 'Upload failed';
          uiStore.getState().setToast(`Image paste failed: ${msg}`);
        },
      );
      return;
    }

    // Readline shortcuts
    if (input === 'a' && key.ctrl) {
      s.moveToLineStart();
      return;
    }
    if (input === 'e' && key.ctrl) {
      s.moveToLineEnd();
      return;
    }
    if (input === 'u' && key.ctrl) {
      s.killLine();
      return;
    }
    if (input === 'w' && key.ctrl) {
      s.deleteWordBack();
      return;
    }
    if (input === 'y' && key.ctrl) {
      s.yank();
      return;
    }
    if (input === 'd' && key.ctrl) {
      s.deleteAt();
      return;
    }

    // Alt/Option + letter (macOS sends ESC+b / ESC+f for Option+Left/Right)
    if (input === 'b' && key.meta) {
      s.moveWordLeft();
      return;
    }
    if (input === 'f' && key.meta) {
      s.moveWordRight();
      return;
    }

    // Page Up / Page Down (key.pageUp/Down or raw escape sequence via ref)
    if (key.pageUp || pageKeysRef.current.pageUp) {
      pageKeysRef.current.pageUp = false;
      s.pageUp(viewportHeight);
      return;
    }
    if (key.pageDown || pageKeysRef.current.pageDown) {
      pageKeysRef.current.pageDown = false;
      s.pageDown(viewportHeight);
      return;
    }

    // Arrow keys (Option+Arrow sends Ctrl modifier on some macOS terminals)
    if (key.upArrow) {
      if (key.meta || key.ctrl) s.pageUp(viewportHeight);
      else s.moveUp();
      return;
    }
    if (key.downArrow) {
      if (key.meta || key.ctrl) s.pageDown(viewportHeight);
      else s.moveDown();
      return;
    }
    if (key.leftArrow) {
      if (key.meta || key.ctrl) s.moveWordLeft();
      else s.moveLeft();
      return;
    }
    if (key.rightArrow) {
      if (key.meta || key.ctrl) s.moveWordRight();
      else s.moveRight();
      return;
    }

    // Backspace & Delete
    if (key.backspace || key.delete) {
      if (isForwardDeleteRef.current) {
        isForwardDeleteRef.current = false;
        s.deleteAt();
      } else {
        s.deleteBefore();
      }
      return;
    }

    // Enter
    if (key.return) {
      s.insertNewline();
      return;
    }

    // Tab / Shift+Tab — indent or outdent list items
    if (key.tab) {
      if (key.shift) s.outdentTab();
      else s.insertTab();
      return;
    }

    // Printable characters
    if (input && !key.ctrl && !key.meta) {
      s.insertChar(input);
    }
  });

  // Compute scroll offset inline using React-subscribed state to avoid
  // stale reads from the store (which lag by one frame via useLayoutEffect).
  const adjustedScroll = computeScrollOffset(
    lines,
    cursor,
    scrollOffset,
    viewportHeight,
    contentWidth,
  );
  const visibleLines = computeVisibleLines(
    lines,
    adjustedScroll,
    viewportHeight,
    contentWidth,
  );
  const lineContexts = computeLineContexts(lines);

  function renderGutter(lineIndex: number, sliceStart: number) {
    const label = sliceStart === 0 ? String(lineIndex + 1) : '';
    return (
      <Box width={gutterWidth} flexShrink={0}>
        <Text dimColor>{label.padStart(gutterDigits, ' ') + ' '}</Text>
      </Box>
    );
  }

  function renderVisibleLine(
    lineIndex: number,
    fullLine: string,
    sliceStart: number,
    context: LineContext,
    key: number,
  ) {
    const sliceEnd = Math.min(sliceStart + contentWidth, fullLine.length);
    const isCursorLine = lineIndex === cursor.row;
    const cursorInSlice =
      isCursorLine &&
      cursor.col >= sliceStart &&
      (cursor.col < sliceEnd || sliceEnd === fullLine.length);

    let content: ReactNode;
    if (sliceStart === 0 && fullLine.length <= contentWidth) {
      content = isCursorLine
        ? highlightLineWithCursor(fullLine, cursor.col, context)
        : highlightLine(fullLine, context);
    } else if (cursorInSlice) {
      content = highlightSliceWithCursor(
        fullLine,
        sliceStart,
        sliceEnd,
        cursor.col,
        context,
      );
    } else {
      content = highlightSlice(fullLine, sliceStart, sliceEnd, context);
    }

    return (
      <Box key={key} overflowX="hidden">
        {renderGutter(lineIndex, sliceStart)}
        <Box overflowX="hidden">{content}</Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={height}>
      {/* Status bar */}
      <Box justifyContent="space-between" overflowX="hidden">
        <Text bold color={accent} wrap="truncate">
          Editing: {draft?.itemId ? `#${draft.itemId} ` : ''}
          {draft?.itemTitle ?? ''}
        </Text>
        <Text dimColor wrap="truncate">
          Ln {cursor.row + 1}, Col {cursor.col + 1}
          {dirty ? ' [modified]' : ''}
          {uploadStatus ? ` ${uploadStatus}` : ''}
        </Text>
      </Box>

      {/* Editor area */}
      <Box flexDirection="column" height={viewportHeight}>
        {visibleLines.map(({ lineIndex, sliceStart }, i) =>
          renderVisibleLine(
            lineIndex,
            lines[lineIndex]!,
            sliceStart,
            lineContexts[lineIndex] ?? 'normal',
            i,
          ),
        )}
        {/* Fill remaining viewport with empty lines */}
        {Array.from({
          length: Math.max(0, viewportHeight - visibleLines.length),
        }).map((_, i) => (
          <Box key={`empty-${i}`}>
            <Box width={gutterWidth} flexShrink={0}>
              <Text dimColor>{' '.repeat(gutterDigits) + ' '}</Text>
            </Box>
            <Text dimColor>~</Text>
          </Box>
        ))}
      </Box>

      {/* Help bar */}
      <Box overflowX="hidden">
        {showDiscardPrompt ? (
          <Text wrap="truncate">
            Discard changes? <Text bold>(d)</Text> discard{'  '}
            <Text bold>(esc)</Text> back
          </Text>
        ) : (
          <Text dimColor wrap="truncate">
            Ctrl+S save │ Esc cancel │ Ctrl+V paste image │ Ctrl+Z undo │ Ctrl+U
            kill line │ Ctrl+Y yank │ Tab/Shift+Tab indent │ Alt+↑↓ page │
            Alt+←→ word
          </Text>
        )}
      </Box>
    </Box>
  );
}
