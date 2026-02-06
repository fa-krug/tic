import { describe, it, expect, beforeEach } from 'vitest';
import { listViewStore } from './listViewStore.js';

beforeEach(() => {
  listViewStore.getState().reset();
});

describe('listViewStore', () => {
  describe('cursor', () => {
    it('sets cursor position', () => {
      listViewStore.getState().setCursor(5);
      expect(listViewStore.getState().cursor).toBe(5);
    });

    it('clamps cursor to valid range', () => {
      listViewStore.getState().setCursor(10);
      listViewStore.getState().clampCursor(5);
      expect(listViewStore.getState().cursor).toBe(5);
    });

    it('does not clamp cursor if already valid', () => {
      listViewStore.getState().setCursor(3);
      listViewStore.getState().clampCursor(5);
      expect(listViewStore.getState().cursor).toBe(3);
    });
  });

  describe('expandedIds', () => {
    it('toggles expanded state on', () => {
      listViewStore.getState().toggleExpanded('item-1');
      expect(listViewStore.getState().expandedIds.has('item-1')).toBe(true);
    });

    it('toggles expanded state off', () => {
      listViewStore.getState().toggleExpanded('item-1');
      listViewStore.getState().toggleExpanded('item-1');
      expect(listViewStore.getState().expandedIds.has('item-1')).toBe(false);
    });
  });

  describe('markedIds', () => {
    it('toggles marked state', () => {
      listViewStore.getState().toggleMarked('item-1');
      expect(listViewStore.getState().markedIds.has('item-1')).toBe(true);
      listViewStore.getState().toggleMarked('item-1');
      expect(listViewStore.getState().markedIds.has('item-1')).toBe(false);
    });

    it('clears all marked items', () => {
      listViewStore.getState().toggleMarked('item-1');
      listViewStore.getState().toggleMarked('item-2');
      listViewStore.getState().clearMarked();
      expect(listViewStore.getState().markedIds.size).toBe(0);
    });
  });

  describe('removeDeletedItem', () => {
    it('removes item from expandedIds and markedIds', () => {
      listViewStore.getState().toggleExpanded('item-1');
      listViewStore.getState().toggleMarked('item-1');
      listViewStore.getState().removeDeletedItem('item-1');
      expect(listViewStore.getState().expandedIds.has('item-1')).toBe(false);
      expect(listViewStore.getState().markedIds.has('item-1')).toBe(false);
    });
  });

  describe('scrollOffset', () => {
    it('sets scroll offset', () => {
      listViewStore.getState().setScrollOffset(100);
      expect(listViewStore.getState().scrollOffset).toBe(100);
    });
  });

  describe('reset', () => {
    it('resets all state', () => {
      listViewStore.getState().setCursor(5);
      listViewStore.getState().toggleExpanded('item-1');
      listViewStore.getState().toggleMarked('item-2');
      listViewStore.getState().setScrollOffset(100);
      listViewStore.getState().reset();

      expect(listViewStore.getState().cursor).toBe(0);
      expect(listViewStore.getState().expandedIds.size).toBe(0);
      expect(listViewStore.getState().markedIds.size).toBe(0);
      expect(listViewStore.getState().scrollOffset).toBe(0);
    });
  });
});
