import { useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { editorStore, useEditorStore } from '../stores/editorStore.js';
import { formStackStore, useFormStackStore } from '../stores/formStackStore.js';
import { navigationStore } from '../stores/navigationStore.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { highlightLine, highlightLineWithCursor } from './markdownHighlight.js';
import { useThemeStore } from '../stores/themeStore.js';

export function MarkdownEditor() {
  const lines = useEditorStore((s) => s.lines);
  const cursor = useEditorStore((s) => s.cursor);
  const dirty = useEditorStore((s) => s.dirty);
  const showDiscardPrompt = useEditorStore((s) => s.showDiscardPrompt);
  const draft = useFormStackStore((s) => s.currentDraft());
  const { height, width } = useTerminalSize();
  const accent = useThemeStore((s) => s.colors.accent);
  const viewportHeight = height - 2; // status bar + help bar

  // Keep scroll in sync with cursor
  useEffect(() => {
    editorStore.getState().updateScroll(viewportHeight, width);
  }, [cursor.row, cursor.col, lines.length, viewportHeight, width]);

  useInput((input, key) => {
    const s = editorStore.getState();

    // Discard prompt mode — only handle d and escape
    if (showDiscardPrompt) {
      if (input === 'd') {
        s.destroy();
        navigationStore.getState().navigate('form');
      }
      if (key.escape) {
        editorStore.setState({ showDiscardPrompt: false });
      }
      return;
    }

    // Save: Ctrl+S
    if (input === 's' && key.ctrl) {
      formStackStore.getState().updateFields({ description: s.getContent() });
      s.destroy();
      navigationStore.getState().navigate('form');
      return;
    }

    // Cancel: Escape
    if (key.escape) {
      if (s.dirty) {
        editorStore.setState({ showDiscardPrompt: true });
      } else {
        s.destroy();
        navigationStore.getState().navigate('form');
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

    // Readline shortcuts
    if (input === 'a' && key.ctrl) {
      s.moveToLineStart();
      return;
    }
    if (input === 'e' && key.ctrl) {
      s.moveToLineEnd();
      return;
    }
    if (input === 'k' && key.ctrl) {
      s.killToEnd();
      return;
    }
    if (input === 'u' && key.ctrl) {
      s.killToStart();
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

    // Arrow keys
    if (key.upArrow) {
      s.moveUp();
      return;
    }
    if (key.downArrow) {
      s.moveDown();
      return;
    }
    if (key.leftArrow) {
      if (key.ctrl) s.moveWordLeft();
      else s.moveLeft();
      return;
    }
    if (key.rightArrow) {
      if (key.ctrl) s.moveWordRight();
      else s.moveRight();
      return;
    }

    // Backspace & Delete
    if (key.backspace || key.delete) {
      if (key.backspace) s.deleteBefore();
      else s.deleteAt();
      return;
    }

    // Enter
    if (key.return) {
      s.insertNewline();
      return;
    }

    // Tab
    if (key.tab) {
      s.insertTab();
      return;
    }

    // Printable characters
    if (input && !key.ctrl && !key.meta) {
      s.insertChar(input);
    }
  });

  const visibleLines = editorStore
    .getState()
    .getVisibleLines(viewportHeight, width);

  function renderLine(lineIndex: number, text: string) {
    if (lineIndex === cursor.row) {
      return (
        <Box key={lineIndex}>{highlightLineWithCursor(text, cursor.col)}</Box>
      );
    }
    return <Box key={lineIndex}>{highlightLine(text)}</Box>;
  }

  return (
    <Box flexDirection="column" height={height}>
      {/* Status bar */}
      <Box justifyContent="space-between">
        <Text bold color={accent}>
          Editing: {draft?.itemId ? `#${draft.itemId} ` : ''}
          {draft?.itemTitle ?? ''}
        </Text>
        <Text dimColor>
          Ln {cursor.row + 1}, Col {cursor.col + 1}
          {dirty ? ' [modified]' : ''}
        </Text>
      </Box>

      {/* Editor area */}
      <Box flexDirection="column" height={viewportHeight}>
        {visibleLines.map(({ lineIndex, text }) => renderLine(lineIndex, text))}
        {/* Fill remaining viewport with empty lines */}
        {Array.from({
          length: Math.max(0, viewportHeight - visibleLines.length),
        }).map((_, i) => (
          <Box key={`empty-${i}`}>
            <Text dimColor>~</Text>
          </Box>
        ))}
      </Box>

      {/* Help bar */}
      <Box>
        {showDiscardPrompt ? (
          <Text>
            Discard changes? <Text bold>(d)</Text> discard{'  '}
            <Text bold>(esc)</Text> back
          </Text>
        ) : (
          <Text dimColor>
            Ctrl+S save Esc cancel Ctrl+Z undo Ctrl+K cut Ctrl+Y yank
          </Text>
        )}
      </Box>
    </Box>
  );
}
