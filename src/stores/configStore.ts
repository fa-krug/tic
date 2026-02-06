import fs from 'node:fs';
import path from 'node:path';
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import yaml from 'yaml';
import {
  type Config,
  defaultConfig,
  readConfig,
  writeConfig,
} from '../backends/local/config.js';

export interface ConfigStoreState {
  config: Config;
  loaded: boolean;
  init(root: string): Promise<void>;
  startWatching(): void;
  update(partial: Partial<Config>): Promise<void>;
  destroy(): void;
}

const WATCH_DEBOUNCE_MS = 50;
const WRITE_FLAG_DURATION_MS = 100;

let watcher: fs.FSWatcher | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let writingTimer: ReturnType<typeof setTimeout> | null = null;
let writing = false;
let currentRoot = '';

export const configStore = createStore<ConfigStoreState>((set, get) => ({
  config: { ...defaultConfig },
  loaded: false,

  async init(root: string) {
    // Clean up any existing watcher from a prior init
    get().destroy();

    currentRoot = root;
    const config = await readConfig(root);
    set({ config, loaded: true });

    get().startWatching();
  },

  startWatching() {
    if (watcher) return; // Already watching
    if (!currentRoot) return;

    // Ensure .tic dir exists before watching
    const ticDir = path.join(currentRoot, '.tic');
    fs.mkdirSync(ticDir, { recursive: true });

    const configPath = path.join(ticDir, 'config.yml');

    // Ensure the config file exists so fs.watch doesn't error
    if (!fs.existsSync(configPath)) {
      fs.writeFileSync(configPath, yaml.stringify(get().config));
    }

    watcher = fs.watch(configPath, () => {
      if (writing) return;

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        readConfig(currentRoot).then(
          (updated) => set({ config: updated }),
          () => {
            // File may have been deleted or be mid-write; ignore
          },
        );
      }, WATCH_DEBOUNCE_MS);
    });
    watcher.on('error', () => {
      watcher?.close();
      watcher = null;
    });
  },

  async update(partial: Partial<Config>) {
    const merged = { ...get().config, ...partial };
    set({ config: merged });

    writing = true;
    await writeConfig(currentRoot, merged);

    // Keep the writing flag on long enough for the watcher to fire and be ignored
    if (writingTimer) clearTimeout(writingTimer);
    writingTimer = setTimeout(() => {
      writing = false;
      writingTimer = null;
    }, WRITE_FLAG_DURATION_MS);
  },

  destroy() {
    if (watcher) {
      watcher.close();
      watcher = null;
    }
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (writingTimer) {
      clearTimeout(writingTimer);
      writingTimer = null;
    }
    writing = false;
    set({ config: { ...defaultConfig }, loaded: false });
  },
}));

export function useConfigStore<T>(selector: (state: ConfigStoreState) => T): T {
  return useStore(configStore, selector);
}
