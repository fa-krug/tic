import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { WorkItem } from '../types.js';
import type { QueueAction } from '../sync/types.js';

export type UndoActionType = 'delete' | 'create' | 'update';

export interface UndoEntry {
  type: UndoActionType;
  label: string;
  itemSnapshots: WorkItem[];
  syncItemIds: string[];
  syncAction: QueueAction;
  createdIds?: string[];
}

const MAX_DEPTH = 5;

export interface UndoStoreState {
  stack: UndoEntry[];
  pushUndo: (entry: UndoEntry) => UndoEntry | undefined;
  popUndo: () => UndoEntry | undefined;
  clear: () => UndoEntry[];
}

export const undoStore = createStore<UndoStoreState>((set, get) => ({
  stack: [],

  pushUndo: (entry) => {
    const { stack } = get();
    const newStack = [entry, ...stack];
    let evicted: UndoEntry | undefined;
    if (newStack.length > MAX_DEPTH) {
      evicted = newStack.pop();
    }
    set({ stack: newStack });
    return evicted;
  },

  popUndo: () => {
    const { stack } = get();
    if (stack.length === 0) return undefined;
    const [first, ...rest] = stack;
    set({ stack: rest });
    return first;
  },

  clear: () => {
    const { stack } = get();
    set({ stack: [] });
    return stack;
  },
}));

export function useUndoStore<T>(selector: (state: UndoStoreState) => T): T {
  return useStore(undoStore, selector);
}
