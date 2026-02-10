// src/stores/filterStore.ts
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { ViewFilters, SavedView } from '../filters.js';

export interface FilterStoreState {
  activeFilters: ViewFilters;
  activeViewName: string | null;

  setFilters: (filters: ViewFilters) => void;
  clearFilters: () => void;
  toggleFilter: (field: keyof ViewFilters, value: string) => void;
  loadView: (view: SavedView) => void;
}

export const filterStore = createStore<FilterStoreState>((set) => ({
  activeFilters: {},
  activeViewName: null,

  setFilters: (filters) =>
    set({ activeFilters: filters, activeViewName: null }),

  clearFilters: () => set({ activeFilters: {}, activeViewName: null }),

  toggleFilter: (field, value) =>
    set((state) => {
      const current = state.activeFilters[field] ?? [];
      const idx = current.indexOf(value);
      let next: string[];
      if (idx === -1) {
        next = [...current, value];
      } else {
        next = current.filter((_, i) => i !== idx);
      }
      const nextFilters = { ...state.activeFilters };
      if (next.length === 0) {
        delete nextFilters[field];
      } else {
        nextFilters[field] = next;
      }
      return { activeFilters: nextFilters, activeViewName: null };
    }),

  loadView: (view) =>
    set({ activeFilters: { ...view.filters }, activeViewName: view.name }),
}));

export function useFilterStore<T>(selector: (state: FilterStoreState) => T): T {
  return useStore(filterStore, selector);
}
