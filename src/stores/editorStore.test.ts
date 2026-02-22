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
});
