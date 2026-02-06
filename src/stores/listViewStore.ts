import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

interface ListViewState {
  cursor: number;
  expandedIds: Set<string>;
  markedIds: Set<string>;
  scrollOffset: number;

  setCursor: (index: number) => void;
  clampCursor: (maxIndex: number) => void;
  toggleExpanded: (id: string) => void;
  toggleMarked: (id: string) => void;
  clearMarked: () => void;
  setScrollOffset: (offset: number) => void;
  removeDeletedItem: (id: string) => void;
  reset: () => void;
}

const initialState = {
  cursor: 0,
  expandedIds: new Set<string>(),
  markedIds: new Set<string>(),
  scrollOffset: 0,
};

export const listViewStore = createStore<ListViewState>((set) => ({
  ...initialState,

  setCursor: (index) => set({ cursor: index }),

  clampCursor: (maxIndex) =>
    set((state) => ({
      cursor: Math.min(state.cursor, Math.max(0, maxIndex)),
    })),

  toggleExpanded: (id) =>
    set((state) => {
      const next = new Set(state.expandedIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { expandedIds: next };
    }),

  toggleMarked: (id) =>
    set((state) => {
      const next = new Set(state.markedIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { markedIds: next };
    }),

  clearMarked: () => set({ markedIds: new Set() }),

  setScrollOffset: (offset) => set({ scrollOffset: offset }),

  removeDeletedItem: (id) =>
    set((state) => {
      const nextExpanded = new Set(state.expandedIds);
      const nextMarked = new Set(state.markedIds);
      nextExpanded.delete(id);
      nextMarked.delete(id);
      return { expandedIds: nextExpanded, markedIds: nextMarked };
    }),

  reset: () =>
    set({
      cursor: 0,
      expandedIds: new Set(),
      markedIds: new Set(),
      scrollOffset: 0,
    }),
}));

export function useListViewStore<T>(selector: (state: ListViewState) => T): T {
  return useStore(listViewStore, selector);
}
