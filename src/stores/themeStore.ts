import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { configStore } from './configStore.js';

export interface ThemeColors {
  accent: string;
  accentBg: string;
  muted: string | undefined;
  mutedDim: boolean;
  success: string;
  error: string;
  warning: string;
  info: string;
  border: string;
  marked: string;
}

export interface ThemeDefinition {
  name: string;
  colors: ThemeColors;
}

const defaultTheme: ThemeColors = {
  accent: 'cyan',
  accentBg: 'cyan',
  muted: undefined,
  mutedDim: true,
  success: 'green',
  error: 'red',
  warning: 'yellow',
  info: 'cyan',
  border: 'gray',
  marked: 'magenta',
};

const highContrastTheme: ThemeColors = {
  accent: 'white',
  accentBg: 'white',
  muted: undefined,
  mutedDim: false,
  success: 'white',
  error: 'white',
  warning: 'white',
  info: 'white',
  border: 'white',
  marked: 'white',
};

export const themes: Record<string, ThemeColors> = {
  default: defaultTheme,
  'high-contrast': highContrastTheme,
};

export interface ThemeStoreState {
  themeName: string;
  colors: ThemeColors;
  setTheme: (name: string) => void;
}

export const themeStore = createStore<ThemeStoreState>((set) => ({
  themeName: 'default',
  colors: { ...defaultTheme },

  setTheme(name: string) {
    const colors = themes[name] ?? defaultTheme;
    set({ themeName: name, colors: { ...colors } });
    void configStore
      .getState()
      .update({ theme: name })
      .catch(() => {});
  },
}));

/** Call after configStore.init() to sync theme from persisted config. */
export function initThemeFromConfig(): void {
  const themeName = configStore.getState().config.theme ?? 'default';
  const colors = themes[themeName] ?? defaultTheme;
  themeStore.setState({ themeName, colors: { ...colors } });
}

export function useThemeStore<T>(selector: (state: ThemeStoreState) => T): T {
  return useStore(themeStore, selector);
}
