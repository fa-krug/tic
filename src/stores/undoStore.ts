import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { WorkItem } from '../types.js';
import type { QueueAction } from '../sync/types.js';
import type { TicDatabase } from '../backends/drizzle/db.js';
import {
  pushUndoEntry,
  popUndoEntry,
  readUndoStack,
  clearUndoStack,
} from '../backends/drizzle/undo.js';

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
  setDatabase: (db: TicDatabase | null) => void;
  initFromDb: () => void;
  destroy: () => void;
}

let currentDb: TicDatabase | null = null;

export const undoStore = createStore<UndoStoreState>((set, get) => ({
  stack: [],

  pushUndo: (entry) => {
    if (currentDb) {
      const evicted = pushUndoEntry(currentDb, entry);
      set({ stack: readUndoStack(currentDb) });
      return evicted;
    }
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
    if (currentDb) {
      const popped = popUndoEntry(currentDb);
      set({ stack: readUndoStack(currentDb) });
      return popped;
    }
    const { stack } = get();
    if (stack.length === 0) return undefined;
    const [first, ...rest] = stack;
    set({ stack: rest });
    return first;
  },

  clear: () => {
    if (currentDb) {
      const entries = clearUndoStack(currentDb);
      set({ stack: [] });
      return entries;
    }
    const { stack } = get();
    set({ stack: [] });
    return stack;
  },

  setDatabase: (db) => {
    currentDb = db;
    if (db) {
      set({ stack: readUndoStack(db) });
    }
  },

  initFromDb: () => {
    if (currentDb) {
      set({ stack: readUndoStack(currentDb) });
    }
  },

  destroy: () => {
    currentDb = null;
    set({ stack: [] });
  },
}));

export function useUndoStore<T>(selector: (state: UndoStoreState) => T): T {
  return useStore(undoStore, selector);
}
