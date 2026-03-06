import { describe, it, expect, beforeEach } from 'vitest';
import { editorStore } from './editorStore.js';

beforeEach(() => {
  editorStore.getState().destroy();
});

describe('editorStore', () => {
  describe('init/destroy', () => {
    it('initializes with content split into lines', () => {
      editorStore.getState().init('hello\nworld');
      const s = editorStore.getState();
      expect(s.lines).toEqual(['hello', 'world']);
      expect(s.cursor).toEqual({ row: 0, col: 0 });
      expect(s.dirty).toBe(false);
    });

    it('initializes empty content as single empty line', () => {
      editorStore.getState().init('');
      expect(editorStore.getState().lines).toEqual(['']);
    });

    it('destroy resets to initial state', () => {
      editorStore.getState().init('hello');
      editorStore.getState().destroy();
      expect(editorStore.getState().lines).toEqual(['']);
      expect(editorStore.getState().dirty).toBe(false);
    });
  });

  describe('getContent', () => {
    it('joins lines with newline', () => {
      editorStore.getState().init('hello\nworld');
      expect(editorStore.getState().getContent()).toBe('hello\nworld');
    });
  });

  describe('insertChar', () => {
    it('inserts character at cursor and advances col', () => {
      editorStore.getState().init('');
      editorStore.getState().insertChar('a');
      const s = editorStore.getState();
      expect(s.lines).toEqual(['a']);
      expect(s.cursor).toEqual({ row: 0, col: 1 });
      expect(s.dirty).toBe(true);
    });

    it('inserts in middle of line', () => {
      editorStore.getState().init('ac');
      editorStore.getState().moveCursorTo(0, 1);
      editorStore.getState().insertChar('b');
      expect(editorStore.getState().lines).toEqual(['abc']);
      expect(editorStore.getState().cursor.col).toBe(2);
    });

    it('handles multi-character input (paste)', () => {
      editorStore.getState().init('ac');
      editorStore.getState().moveCursorTo(0, 1);
      editorStore.getState().insertChar('bbb');
      expect(editorStore.getState().lines).toEqual(['abbbc']);
      expect(editorStore.getState().cursor.col).toBe(4);
    });
  });

  describe('insertNewline', () => {
    it('splits line at cursor position', () => {
      editorStore.getState().init('hello world');
      editorStore.getState().moveCursorTo(0, 5);
      editorStore.getState().insertNewline();
      const s = editorStore.getState();
      expect(s.lines).toEqual(['hello', ' world']);
      expect(s.cursor).toEqual({ row: 1, col: 0 });
    });

    it('continues "- " list marker at end of line', () => {
      editorStore.getState().init('- item one');
      editorStore.getState().moveCursorTo(0, 10);
      editorStore.getState().insertNewline();
      const s = editorStore.getState();
      expect(s.lines).toEqual(['- item one', '- ']);
      expect(s.cursor).toEqual({ row: 1, col: 2 });
    });

    it('continues "* " list marker at end of line', () => {
      editorStore.getState().init('* item one');
      editorStore.getState().moveCursorTo(0, 10);
      editorStore.getState().insertNewline();
      const s = editorStore.getState();
      expect(s.lines).toEqual(['* item one', '* ']);
      expect(s.cursor).toEqual({ row: 1, col: 2 });
    });

    it('continues "+ " list marker at end of line', () => {
      editorStore.getState().init('+ item one');
      editorStore.getState().moveCursorTo(0, 10);
      editorStore.getState().insertNewline();
      const s = editorStore.getState();
      expect(s.lines).toEqual(['+ item one', '+ ']);
      expect(s.cursor).toEqual({ row: 1, col: 2 });
    });

    it('continues numbered list marker at end of line', () => {
      editorStore.getState().init('1. first item');
      editorStore.getState().moveCursorTo(0, 13);
      editorStore.getState().insertNewline();
      const s = editorStore.getState();
      expect(s.lines).toEqual(['1. first item', '2. ']);
      expect(s.cursor).toEqual({ row: 1, col: 3 });
    });

    it('increments multi-digit numbered list', () => {
      editorStore.getState().init('99. item');
      editorStore.getState().moveCursorTo(0, 8);
      editorStore.getState().insertNewline();
      const s = editorStore.getState();
      expect(s.lines).toEqual(['99. item', '100. ']);
      expect(s.cursor).toEqual({ row: 1, col: 5 });
    });

    it('continues "- [ ] " todo marker at end of line', () => {
      editorStore.getState().init('- [ ] todo item');
      editorStore.getState().moveCursorTo(0, 15);
      editorStore.getState().insertNewline();
      const s = editorStore.getState();
      expect(s.lines).toEqual(['- [ ] todo item', '- [ ] ']);
      expect(s.cursor).toEqual({ row: 1, col: 6 });
    });

    it('continues checked "- [x] " as unchecked on new line', () => {
      editorStore.getState().init('- [x] done item');
      editorStore.getState().moveCursorTo(0, 15);
      editorStore.getState().insertNewline();
      const s = editorStore.getState();
      expect(s.lines).toEqual(['- [x] done item', '- [ ] ']);
      expect(s.cursor).toEqual({ row: 1, col: 6 });
    });

    it('preserves indentation with list marker', () => {
      editorStore.getState().init('  - nested item');
      editorStore.getState().moveCursorTo(0, 15);
      editorStore.getState().insertNewline();
      const s = editorStore.getState();
      expect(s.lines).toEqual(['  - nested item', '  - ']);
      expect(s.cursor).toEqual({ row: 1, col: 4 });
    });

    it('preserves indentation with numbered list', () => {
      editorStore.getState().init('    1. deep item');
      editorStore.getState().moveCursorTo(0, 16);
      editorStore.getState().insertNewline();
      const s = editorStore.getState();
      expect(s.lines).toEqual(['    1. deep item', '    2. ']);
      expect(s.cursor).toEqual({ row: 1, col: 7 });
    });

    it('removes marker when pressing enter on empty list item', () => {
      editorStore.getState().init('- item\n- ');
      editorStore.getState().moveCursorTo(1, 2);
      editorStore.getState().insertNewline();
      const s = editorStore.getState();
      expect(s.lines).toEqual(['- item', '']);
      expect(s.cursor).toEqual({ row: 1, col: 0 });
    });

    it('removes marker when pressing enter on empty todo item', () => {
      editorStore.getState().init('- [ ] item\n- [ ] ');
      editorStore.getState().moveCursorTo(1, 6);
      editorStore.getState().insertNewline();
      const s = editorStore.getState();
      expect(s.lines).toEqual(['- [ ] item', '']);
      expect(s.cursor).toEqual({ row: 1, col: 0 });
    });

    it('does not continue list when cursor is in the middle of line', () => {
      editorStore.getState().init('- item one');
      editorStore.getState().moveCursorTo(0, 5);
      editorStore.getState().insertNewline();
      const s = editorStore.getState();
      expect(s.lines).toEqual(['- ite', 'm one']);
      expect(s.cursor).toEqual({ row: 1, col: 0 });
    });
  });

  describe('deleteBefore (backspace)', () => {
    it('deletes character before cursor', () => {
      editorStore.getState().init('abc');
      editorStore.getState().moveCursorTo(0, 2);
      editorStore.getState().deleteBefore();
      expect(editorStore.getState().lines).toEqual(['ac']);
      expect(editorStore.getState().cursor.col).toBe(1);
    });

    it('joins with previous line at col 0', () => {
      editorStore.getState().init('hello\nworld');
      editorStore.getState().moveCursorTo(1, 0);
      editorStore.getState().deleteBefore();
      expect(editorStore.getState().lines).toEqual(['helloworld']);
      expect(editorStore.getState().cursor).toEqual({ row: 0, col: 5 });
    });

    it('does nothing at start of document', () => {
      editorStore.getState().init('hello');
      editorStore.getState().moveCursorTo(0, 0);
      editorStore.getState().deleteBefore();
      expect(editorStore.getState().lines).toEqual(['hello']);
    });
  });

  describe('deleteAt (delete key)', () => {
    it('deletes character at cursor', () => {
      editorStore.getState().init('abc');
      editorStore.getState().moveCursorTo(0, 1);
      editorStore.getState().deleteAt();
      expect(editorStore.getState().lines).toEqual(['ac']);
      expect(editorStore.getState().cursor.col).toBe(1);
    });

    it('joins with next line at end of line', () => {
      editorStore.getState().init('hello\nworld');
      editorStore.getState().moveCursorTo(0, 5);
      editorStore.getState().deleteAt();
      expect(editorStore.getState().lines).toEqual(['helloworld']);
    });

    it('does nothing at end of document', () => {
      editorStore.getState().init('hello');
      editorStore.getState().moveCursorTo(0, 5);
      editorStore.getState().deleteAt();
      expect(editorStore.getState().lines).toEqual(['hello']);
    });
  });

  describe('cursor movement', () => {
    it('moves left', () => {
      editorStore.getState().init('abc');
      editorStore.getState().moveCursorTo(0, 2);
      editorStore.getState().moveLeft();
      expect(editorStore.getState().cursor.col).toBe(1);
    });

    it('moves left wraps to previous line end', () => {
      editorStore.getState().init('ab\ncd');
      editorStore.getState().moveCursorTo(1, 0);
      editorStore.getState().moveLeft();
      expect(editorStore.getState().cursor).toEqual({ row: 0, col: 2 });
    });

    it('moves left does nothing at document start', () => {
      editorStore.getState().init('abc');
      editorStore.getState().moveCursorTo(0, 0);
      editorStore.getState().moveLeft();
      expect(editorStore.getState().cursor).toEqual({ row: 0, col: 0 });
    });

    it('moves right', () => {
      editorStore.getState().init('abc');
      editorStore.getState().moveCursorTo(0, 1);
      editorStore.getState().moveRight();
      expect(editorStore.getState().cursor.col).toBe(2);
    });

    it('moves right wraps to next line start', () => {
      editorStore.getState().init('ab\ncd');
      editorStore.getState().moveCursorTo(0, 2);
      editorStore.getState().moveRight();
      expect(editorStore.getState().cursor).toEqual({ row: 1, col: 0 });
    });

    it('moves right does nothing at document end', () => {
      editorStore.getState().init('abc');
      editorStore.getState().moveCursorTo(0, 3);
      editorStore.getState().moveRight();
      expect(editorStore.getState().cursor).toEqual({ row: 0, col: 3 });
    });

    it('moves up preserving goalCol', () => {
      editorStore.getState().init('long line\nhi\nanother long');
      editorStore.getState().moveCursorTo(0, 8);
      editorStore.getState().moveDown(); // row 1, col clamped to 2
      expect(editorStore.getState().cursor).toEqual({ row: 1, col: 2 });
      editorStore.getState().moveDown(); // row 2, col restored to 8
      expect(editorStore.getState().cursor).toEqual({ row: 2, col: 8 });
    });

    it('moveUp on first line jumps to start of line', () => {
      editorStore.getState().init('abc');
      editorStore.getState().moveCursorTo(0, 2);
      editorStore.getState().moveUp();
      expect(editorStore.getState().cursor).toEqual({ row: 0, col: 0 });
    });

    it('moveDown on last line jumps to end of line', () => {
      editorStore.getState().init('abc');
      editorStore.getState().moveCursorTo(0, 0);
      editorStore.getState().moveDown();
      expect(editorStore.getState().cursor).toEqual({ row: 0, col: 3 });
    });

    it('moveToLineStart sets col to 0', () => {
      editorStore.getState().init('hello');
      editorStore.getState().moveCursorTo(0, 3);
      editorStore.getState().moveToLineStart();
      expect(editorStore.getState().cursor.col).toBe(0);
    });

    it('moveToLineEnd sets col to line length', () => {
      editorStore.getState().init('hello');
      editorStore.getState().moveCursorTo(0, 0);
      editorStore.getState().moveToLineEnd();
      expect(editorStore.getState().cursor.col).toBe(5);
    });

    it('moveWordLeft jumps to previous word boundary', () => {
      editorStore.getState().init('hello world foo');
      editorStore.getState().moveCursorTo(0, 15);
      editorStore.getState().moveWordLeft();
      expect(editorStore.getState().cursor.col).toBe(12);
      editorStore.getState().moveWordLeft();
      expect(editorStore.getState().cursor.col).toBe(6);
      editorStore.getState().moveWordLeft();
      expect(editorStore.getState().cursor.col).toBe(0);
    });

    it('moveWordRight jumps to next word boundary', () => {
      editorStore.getState().init('hello world foo');
      editorStore.getState().moveCursorTo(0, 0);
      editorStore.getState().moveWordRight();
      expect(editorStore.getState().cursor.col).toBe(5);
      editorStore.getState().moveWordRight();
      expect(editorStore.getState().cursor.col).toBe(11);
    });
  });

  describe('kill/yank', () => {
    it('killLine removes entire line and stores in killBuffer', () => {
      editorStore.getState().init('hello\nworld\nfoo');
      editorStore.getState().moveCursorTo(1, 3);
      editorStore.getState().killLine();
      expect(editorStore.getState().lines).toEqual(['hello', 'foo']);
      expect(editorStore.getState().killBuffer).toBe('world');
      expect(editorStore.getState().cursor.row).toBe(1);
    });

    it('killLine on single line clears it but keeps empty line', () => {
      editorStore.getState().init('hello');
      editorStore.getState().moveCursorTo(0, 3);
      editorStore.getState().killLine();
      expect(editorStore.getState().lines).toEqual(['']);
      expect(editorStore.getState().killBuffer).toBe('hello');
      expect(editorStore.getState().cursor).toEqual({ row: 0, col: 0 });
    });

    it('killLine on last line moves cursor up', () => {
      editorStore.getState().init('hello\nworld');
      editorStore.getState().moveCursorTo(1, 3);
      editorStore.getState().killLine();
      expect(editorStore.getState().lines).toEqual(['hello']);
      expect(editorStore.getState().cursor.row).toBe(0);
    });

    it('deleteWordBack removes previous word', () => {
      editorStore.getState().init('hello world');
      editorStore.getState().moveCursorTo(0, 11);
      editorStore.getState().deleteWordBack();
      expect(editorStore.getState().lines).toEqual(['hello ']);
      expect(editorStore.getState().cursor.col).toBe(6);
    });

    it('yank inserts kill buffer at cursor', () => {
      editorStore.getState().init('hello\nworld');
      editorStore.getState().moveCursorTo(0, 0);
      editorStore.getState().killLine();
      // killed "hello", now lines = ["world"], cursor at row 0
      editorStore.getState().moveCursorTo(0, 0);
      editorStore.getState().yank();
      expect(editorStore.getState().lines).toEqual(['helloworld']);
    });

    it('insertTab inserts two spaces', () => {
      editorStore.getState().init('hello');
      editorStore.getState().moveCursorTo(0, 0);
      editorStore.getState().insertTab();
      expect(editorStore.getState().lines).toEqual(['  hello']);
      expect(editorStore.getState().cursor.col).toBe(2);
    });
  });

  describe('page navigation', () => {
    it('pageDown jumps half viewport down', () => {
      editorStore.getState().init('a\nb\nc\nd\ne\nf\ng\nh\ni\nj');
      editorStore.getState().moveCursorTo(0, 0);
      editorStore.getState().pageDown(10); // jump = 5
      expect(editorStore.getState().cursor.row).toBe(5);
    });

    it('pageUp jumps half viewport up', () => {
      editorStore.getState().init('a\nb\nc\nd\ne\nf\ng\nh\ni\nj');
      editorStore.getState().moveCursorTo(8, 0);
      editorStore.getState().pageUp(10); // jump = 5
      expect(editorStore.getState().cursor.row).toBe(3);
    });

    it('pageDown clamps to last line', () => {
      editorStore.getState().init('a\nb\nc');
      editorStore.getState().moveCursorTo(1, 0);
      editorStore.getState().pageDown(10); // jump = 5, but only 3 lines
      expect(editorStore.getState().cursor.row).toBe(2);
    });

    it('pageUp clamps to first line', () => {
      editorStore.getState().init('a\nb\nc');
      editorStore.getState().moveCursorTo(1, 0);
      editorStore.getState().pageUp(10); // jump = 5
      expect(editorStore.getState().cursor.row).toBe(0);
    });

    it('pageDown preserves goalCol', () => {
      editorStore.getState().init('long line\na\nb\nc\nd\nanother long');
      editorStore.getState().moveCursorTo(0, 8); // goalCol = 8
      editorStore.getState().pageDown(4); // jump = 2, row 2 "b" len=1
      expect(editorStore.getState().cursor).toEqual({ row: 2, col: 1 });
    });
  });

  describe('viewport scrolling', () => {
    it('updateScroll keeps cursor visible when below viewport', () => {
      editorStore.getState().init('a\nb\nc\nd\ne\nf');
      // viewport of 3 visual rows, terminal width 80 (no wrapping)
      editorStore.getState().moveCursorTo(4, 0); // row 4 "e"
      editorStore.getState().updateScroll(3, 80);
      // cursor at visual row 4, viewport 3 → scroll so cursor is visible
      expect(editorStore.getState().scrollOffset).toBe(2);
    });

    it('scrolls up when cursor moves above viewport', () => {
      editorStore.getState().init('a\nb\nc\nd\ne');
      editorStore.getState().moveCursorTo(4, 0);
      editorStore.getState().updateScroll(3, 80);
      editorStore.getState().moveCursorTo(1, 0);
      editorStore.getState().updateScroll(3, 80);
      expect(editorStore.getState().scrollOffset).toBe(1);
    });

    it('does not scroll when cursor is within viewport', () => {
      editorStore.getState().init('a\nb\nc\nd\ne');
      editorStore.getState().moveCursorTo(1, 0);
      editorStore.getState().updateScroll(3, 80);
      expect(editorStore.getState().scrollOffset).toBe(0);
    });

    it('accounts for soft-wrapped lines', () => {
      // Line of 160 chars at width 80 takes 2 visual rows
      editorStore.getState().init('x'.repeat(160) + '\nb\nc');
      editorStore.getState().moveCursorTo(2, 0); // row 2 "c"
      editorStore.getState().updateScroll(3, 80);
      // visual rows: row0=2, row1=1, row2=1 → cursor at visual row 3
      // viewport=3, so need to scroll
      expect(editorStore.getState().scrollOffset).toBeGreaterThan(0);
    });

    it('getVisibleLines returns lines within viewport', () => {
      editorStore.getState().init('a\nb\nc\nd\ne');
      editorStore.getState().moveCursorTo(3, 0);
      editorStore.getState().updateScroll(3, 80);
      const visible = editorStore.getState().getVisibleLines(3, 80);
      expect(visible.length).toBeLessThanOrEqual(5); // at most all lines
      expect(visible.length).toBeGreaterThan(0);
    });

    it('getVisibleLines returns correct line indices after scroll', () => {
      editorStore.getState().init('a\nb\nc\nd\ne');
      editorStore.getState().moveCursorTo(4, 0);
      editorStore.getState().updateScroll(3, 80);
      // scrollOffset should be 2, so lines at index 2,3,4 visible
      const visible = editorStore.getState().getVisibleLines(3, 80);
      expect(visible.map((v) => v.lineIndex)).toEqual([2, 3, 4]);
      expect(visible.map((v) => v.text)).toEqual(['c', 'd', 'e']);
    });

    it('getVisibleLines splits long lines into sub-lines', () => {
      // Line of 20 chars at width 10 → 2 visual rows
      editorStore.getState().init('abcdefghijklmnopqrst\nxy');
      editorStore.getState().updateScroll(5, 10);
      const visible = editorStore.getState().getVisibleLines(5, 10);
      expect(visible).toEqual([
        { lineIndex: 0, text: 'abcdefghij', sliceStart: 0 },
        { lineIndex: 0, text: 'klmnopqrst', sliceStart: 10 },
        { lineIndex: 1, text: 'xy', sliceStart: 0 },
      ]);
    });

    it('getVisibleLines respects viewport height with wrapped lines', () => {
      // 30-char line at width 10 → 3 visual rows, viewport of 2
      editorStore.getState().init('abcdefghijklmnopqrstuvwxyz1234');
      editorStore.getState().updateScroll(2, 10);
      const visible = editorStore.getState().getVisibleLines(2, 10);
      expect(visible.length).toBe(2);
      expect(visible[0]!.text).toBe('abcdefghij');
      expect(visible[1]!.text).toBe('klmnopqrst');
    });

    it('getVisibleLines includes sliceStart for sub-lines', () => {
      editorStore.getState().init('abcdefghijklmno'); // 15 chars, width 10 → 2 rows
      editorStore.getState().updateScroll(5, 10);
      const visible = editorStore.getState().getVisibleLines(5, 10);
      expect(visible[0]!.sliceStart).toBe(0);
      expect(visible[1]!.sliceStart).toBe(10);
      expect(visible[1]!.text).toBe('klmno');
    });
  });

  describe('undo/redo', () => {
    it('undo reverses last edit', () => {
      editorStore.getState().init('hello');
      editorStore.getState().moveCursorTo(0, 5);
      editorStore.getState().insertChar('!');
      expect(editorStore.getState().lines).toEqual(['hello!']);
      editorStore.getState().undo();
      expect(editorStore.getState().lines).toEqual(['hello']);
      expect(editorStore.getState().cursor).toEqual({ row: 0, col: 5 });
    });

    it('redo restores undone edit', () => {
      editorStore.getState().init('hello');
      editorStore.getState().moveCursorTo(0, 5);
      editorStore.getState().insertChar('!');
      editorStore.getState().undo();
      editorStore.getState().redo();
      expect(editorStore.getState().lines).toEqual(['hello!']);
    });

    it('new edit clears redo stack', () => {
      editorStore.getState().init('hello');
      editorStore.getState().moveCursorTo(0, 5);
      editorStore.getState().insertChar('!');
      editorStore.getState().undo();
      editorStore.getState().insertChar('?');
      editorStore.getState().redo(); // should do nothing
      expect(editorStore.getState().lines).toEqual(['hello?']);
    });

    it('undo does nothing when stack is empty', () => {
      editorStore.getState().init('hello');
      editorStore.getState().undo();
      expect(editorStore.getState().lines).toEqual(['hello']);
    });

    it('undo stack is capped at 50', () => {
      editorStore.getState().init('');
      for (let i = 0; i < 60; i++) {
        editorStore.getState().insertChar('x');
      }
      expect(editorStore.getState().undoStack.length).toBeLessThanOrEqual(50);
    });

    it('undo restores dirty to false when back to initial', () => {
      editorStore.getState().init('hello');
      editorStore.getState().moveCursorTo(0, 5);
      editorStore.getState().insertChar('!');
      expect(editorStore.getState().dirty).toBe(true);
      editorStore.getState().undo();
      expect(editorStore.getState().dirty).toBe(false);
    });
  });
});
