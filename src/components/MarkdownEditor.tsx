import { useLayoutEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { editorStore, useEditorStore } from '../stores/editorStore.js';
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
import { readClipboardImage } from '../clipboard.js';
import { uploadImageToGitHub } from '../backends/github/image-upload.js';
import { isImageUploadBackend } from '../backends/github/index.js';
import { getRemoteBackend } from '../stores/backendDataStore.js';
import { configStore } from '../stores/configStore.js';
import { uiStore } from '../stores/uiStore.js';
import { getDefaultBranch } from '../git.js';

export function MarkdownEditor() {
  const lines = useEditorStore((s) => s.lines);
  const cursor = useEditorStore((s) => s.cursor);
  const scrollOffset = useEditorStore((s) => s.scrollOffset);
  const dirty = useEditorStore((s) => s.dirty);
  const showDiscardPrompt = useEditorStore((s) => s.showDiscardPrompt);
  const uploadStatus = useEditorStore((s) => s.uploadStatus);
  const draft = useFormStackStore((s) => s.currentDraft());
  const { height, width } = useTerminalSize();
  const accent = useThemeStore((s) => s.colors.accent);
  const viewportHeight = height - 2; // status bar + help bar

  // Keep scroll in sync with cursor (useLayoutEffect to update before paint)
  useLayoutEffect(() => {
    editorStore.getState().updateScroll(viewportHeight, width);
  }, [
    cursor.row,
    cursor.col,
    lines.length,
    viewportHeight,
    width,
    scrollOffset,
  ]);

  useInput((input, key) => {
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
      if (editorStore.getState().uploadStatus) return; // upload already in progress

      const backendType = configStore.getState().config.backend;
      if (backendType !== 'github') return;

      const imageData = readClipboardImage();
      if (!imageData) return;

      const remoteBackend = getRemoteBackend();
      if (!remoteBackend || !isImageUploadBackend(remoteBackend)) return;

      const { api, owner, repo } = remoteBackend.getImageUploadInfo();
      editorStore.setState({ uploadStatus: 'Uploading image...' });

      const branch = getDefaultBranch();

      uploadImageToGitHub(api, owner, repo, branch, imageData)
        .then((url) => {
          editorStore.getState().insertText(`![image](${url})`);
          editorStore.setState({ uploadStatus: null });
        })
        .catch((err: unknown) => {
          editorStore.setState({ uploadStatus: null });
          const msg = err instanceof Error ? err.message : 'Upload failed';
          uiStore.getState().setToast(`Image upload failed: ${msg}`);
        });
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
    // Ink 6 maps the physical Backspace key (\x7f) to key.delete, not
    // key.backspace (\x08/ctrl+h). Both the physical Backspace and Delete
    // keys report key.delete, so we treat key.delete as backspace (the
    // common case) and use Ctrl+D for forward-delete.
    if (key.backspace || key.delete) {
      s.deleteBefore();
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
  const lineContexts = computeLineContexts(lines);

  function renderVisibleLine(
    lineIndex: number,
    fullLine: string,
    sliceStart: number,
    context: LineContext,
    key: number,
  ) {
    const sliceEnd = Math.min(sliceStart + width, fullLine.length);
    const isCursorLine = lineIndex === cursor.row;
    const cursorInSlice =
      isCursorLine &&
      cursor.col >= sliceStart &&
      (cursor.col < sliceEnd || sliceEnd === fullLine.length);

    if (sliceStart === 0 && fullLine.length <= width) {
      // Short line — no wrapping needed, use fast path
      if (isCursorLine) {
        return (
          <Box key={key}>
            {highlightLineWithCursor(fullLine, cursor.col, context)}
          </Box>
        );
      }
      return <Box key={key}>{highlightLine(fullLine, context)}</Box>;
    }

    // Wrapped sub-line
    if (cursorInSlice) {
      return (
        <Box key={key}>
          {highlightSliceWithCursor(
            fullLine,
            sliceStart,
            sliceEnd,
            cursor.col,
            context,
          )}
        </Box>
      );
    }
    return (
      <Box key={key}>
        {highlightSlice(fullLine, sliceStart, sliceEnd, context)}
      </Box>
    );
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
            Ctrl+S save Esc cancel Ctrl+V paste image Ctrl+Z undo Ctrl+U kill
            line Ctrl+Y yank Alt+↑↓ page Alt+←→ word
          </Text>
        )}
      </Box>
    </Box>
  );
}
