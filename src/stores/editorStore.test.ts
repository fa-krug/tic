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
});
