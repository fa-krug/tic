import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const MAX_RECENT = 5;
const FILENAME = 'recent-commands.json';

let writeChain = Promise.resolve();

export interface RecentCommandsStoreState {
  recentIds: string[];
  root: string | null;
  init: (root: string) => Promise<void>;
  addRecent: (id: string) => void;
  destroy: () => void;
}

export const recentCommandsStore = createStore<RecentCommandsStoreState>(
  (set, get) => ({
    recentIds: [],
    root: null,

    init: async (root) => {
      const filePath = join(root, '.tic', FILENAME);
      let recentIds: string[] = [];
      try {
        const data = await readFile(filePath, 'utf-8');
        const parsed: unknown = JSON.parse(data);
        if (Array.isArray(parsed)) {
          recentIds = parsed
            .filter((v): v is string => typeof v === 'string')
            .slice(0, MAX_RECENT);
        }
      } catch {
        // Missing or corrupted file — start with empty list
      }
      set({ recentIds, root });
    },

    addRecent: (id) => {
      const { recentIds, root } = get();
      const filtered = recentIds.filter((v) => v !== id);
      const updated = [id, ...filtered].slice(0, MAX_RECENT);
      set({ recentIds: updated });

      if (root) {
        const filePath = join(root, '.tic', FILENAME);
        writeChain = writeChain
          .then(() =>
            mkdir(join(root, '.tic'), { recursive: true }).then(() =>
              writeFile(filePath, JSON.stringify(updated) + '\n'),
            ),
          )
          .catch(() => {});
      }
    },

    destroy: () => {
      writeChain = Promise.resolve();
      set({ recentIds: [], root: null });
    },
  }),
);

export function useRecentCommandsStore<T>(
  selector: (state: RecentCommandsStoreState) => T,
): T {
  return useStore(recentCommandsStore, selector);
}
