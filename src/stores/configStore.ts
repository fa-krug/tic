import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { type Config, defaultConfig } from '../storage/config.js';
import {
  readConfig as readConfigFromDb,
  writeConfig as writeConfigToDb,
} from '../storage/config.js';
import type { TicDatabase } from '../storage/db.js';

export interface ConfigStoreState {
  config: Config;
  loaded: boolean;
  init(root: string): Promise<void>;
  startWatching(): void;
  update(partial: Partial<Config>): Promise<void>;
  setDatabase(db: TicDatabase | null): void;
  destroy(): void;
}

let currentDb: TicDatabase | null = null;

export const configStore = createStore<ConfigStoreState>((set, get) => ({
  config: { ...defaultConfig },
  loaded: false,

  // eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-unused-vars
  async init(_root: string) {
    // Preserve database reference across the internal destroy
    const db = currentDb;
    get().destroy();
    currentDb = db;
    if (currentDb) {
      const config = readConfigFromDb(currentDb);
      set({ config, loaded: true });
    } else {
      // No DB — fall back to defaults
      set({ config: { ...defaultConfig }, loaded: true });
    }
  },

  startWatching() {
    // No-op — DB is the source of truth, no file watcher needed
  },

  // eslint-disable-next-line @typescript-eslint/require-await
  async update(partial: Partial<Config>) {
    const merged = { ...get().config, ...partial };
    set({ config: merged });

    if (currentDb) {
      writeConfigToDb(currentDb, merged);
    }
  },

  setDatabase(db: TicDatabase | null) {
    currentDb = db;
  },

  destroy() {
    currentDb = null;
    set({ config: { ...defaultConfig }, loaded: false });
  },
}));

export function useConfigStore<T>(selector: (state: ConfigStoreState) => T): T {
  return useStore(configStore, selector);
}
