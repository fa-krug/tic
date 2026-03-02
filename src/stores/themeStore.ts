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
  selectionBg: string;
  selectedMarkedBg: string;
}

export interface ThemeDefinition {
  name: string;
  colors: ThemeColors;
}

export type FieldType = 'status' | 'priority' | 'type' | 'label';

export interface FieldColor {
  bg: string;
  fg: string;
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
  selectionBg: 'cyanBright',
  selectedMarkedBg: 'magentaBright',
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
  selectionBg: 'whiteBright',
  selectedMarkedBg: 'whiteBright',
};

export const themes: Record<string, ThemeColors> = {
  default: defaultTheme,
  'high-contrast': highContrastTheme,
};

// --- Keyword default tables ---

interface KeywordRule {
  patterns: string[];
  color: FieldColor;
}

type FieldDefaults = Partial<Record<FieldType, KeywordRule[]>>;

const defaultDefaults: FieldDefaults = {
  status: [
    { patterns: ['done', 'closed'], color: { bg: 'green', fg: 'white' } },
    {
      patterns: ['progress', 'active'],
      color: { bg: 'blue', fg: 'white' },
    },
    {
      patterns: ['todo', 'open', 'new'],
      color: { bg: 'gray', fg: 'white' },
    },
    { patterns: ['blocked'], color: { bg: 'red', fg: 'white' } },
    { patterns: ['merged'], color: { bg: 'magenta', fg: 'white' } },
    { patterns: ['draft'], color: { bg: 'gray', fg: 'white' } },
  ],
  priority: [
    { patterns: ['critical'], color: { bg: 'red', fg: 'white' } },
    { patterns: ['high'], color: { bg: 'yellow', fg: 'black' } },
    { patterns: ['medium'], color: { bg: 'cyan', fg: 'black' } },
    { patterns: ['low'], color: { bg: 'gray', fg: 'white' } },
  ],
  type: [
    { patterns: ['bug'], color: { bg: 'red', fg: 'white' } },
    { patterns: ['feature'], color: { bg: 'blue', fg: 'white' } },
    { patterns: ['task'], color: { bg: 'gray', fg: 'white' } },
    { patterns: ['epic'], color: { bg: 'magenta', fg: 'white' } },
  ],
};

const highContrastDefaults: FieldDefaults = {
  status: [
    {
      patterns: ['done', 'closed'],
      color: { bg: 'greenBright', fg: 'white' },
    },
    {
      patterns: ['progress', 'active'],
      color: { bg: 'blueBright', fg: 'white' },
    },
    {
      patterns: ['todo', 'open', 'new'],
      color: { bg: 'grayBright', fg: 'white' },
    },
    { patterns: ['blocked'], color: { bg: 'redBright', fg: 'white' } },
    { patterns: ['merged'], color: { bg: 'magentaBright', fg: 'white' } },
    { patterns: ['draft'], color: { bg: 'grayBright', fg: 'white' } },
  ],
  priority: [
    { patterns: ['critical'], color: { bg: 'redBright', fg: 'white' } },
    { patterns: ['high'], color: { bg: 'yellowBright', fg: 'black' } },
    { patterns: ['medium'], color: { bg: 'cyanBright', fg: 'white' } },
    { patterns: ['low'], color: { bg: 'grayBright', fg: 'white' } },
  ],
  type: [
    { patterns: ['bug'], color: { bg: 'redBright', fg: 'white' } },
    { patterns: ['feature'], color: { bg: 'blueBright', fg: 'white' } },
    { patterns: ['task'], color: { bg: 'grayBright', fg: 'white' } },
    { patterns: ['epic'], color: { bg: 'magentaBright', fg: 'white' } },
  ],
};

// --- Label hashing ---

const LABEL_PALETTE: FieldColor[] = [
  { bg: 'blue', fg: 'white' },
  { bg: 'green', fg: 'white' },
  { bg: 'magenta', fg: 'white' },
  { bg: 'cyan', fg: 'white' },
  { bg: 'yellow', fg: 'black' },
  { bg: 'red', fg: 'white' },
  { bg: 'blueBright', fg: 'white' },
  { bg: 'greenBright', fg: 'black' },
  { bg: 'magentaBright', fg: 'white' },
  { bg: 'cyanBright', fg: 'black' },
];

function hashLabel(lower: string): FieldColor {
  let hash = 0;
  for (let i = 0; i < lower.length; i++) {
    hash = (hash * 31 + lower.charCodeAt(i)) % LABEL_PALETTE.length;
  }
  // Ensure non-negative index
  hash =
    ((hash % LABEL_PALETTE.length) + LABEL_PALETTE.length) %
    LABEL_PALETTE.length;
  return LABEL_PALETTE[hash]!;
}

// --- autoFg helper ---

export function autoFg(bg: string): string {
  const lightBgs = [
    'yellow',
    'cyan',
    'white',
    'yellowBright',
    'cyanBright',
    'whiteBright',
    'greenBright',
  ];
  return lightBgs.includes(bg) ? 'black' : 'white';
}

// --- Store ---

export interface ThemeStoreState {
  themeName: string;
  colors: ThemeColors;
  colorOverrides: Record<string, Record<string, FieldColor>>;
  setTheme: (name: string) => void;
  resolveFieldColor: (field: FieldType, value: string) => FieldColor | null;
  loadColorOverrides: (
    mappings: { fieldType: string; value: string; bg: string; fg: string }[],
  ) => void;
}

export const themeStore = createStore<ThemeStoreState>((set, get) => ({
  themeName: 'default',
  colors: { ...defaultTheme },
  colorOverrides: {},

  setTheme(name: string) {
    const colors = themes[name] ?? defaultTheme;
    set({ themeName: name, colors: { ...colors } });
    void configStore
      .getState()
      .update({ theme: name })
      .catch(() => {});
  },

  resolveFieldColor(field: FieldType, value: string): FieldColor | null {
    const state = get();
    const lower = value.toLowerCase();

    // 1. User override
    const override = state.colorOverrides[field]?.[lower];
    if (override) return override;

    // 2. Keyword defaults
    const themeDefaults =
      state.themeName === 'high-contrast'
        ? highContrastDefaults
        : defaultDefaults;
    const fieldDefaults = themeDefaults[field];
    if (fieldDefaults) {
      for (const rule of fieldDefaults) {
        if (rule.patterns.some((p) => lower.includes(p))) {
          return rule.color;
        }
      }
    }

    // 3. Label hash (labels only)
    if (field === 'label') {
      return hashLabel(lower);
    }

    return null;
  },

  loadColorOverrides(
    mappings: { fieldType: string; value: string; bg: string; fg: string }[],
  ) {
    const overrides: Record<string, Record<string, FieldColor>> = {};
    for (const m of mappings) {
      if (!overrides[m.fieldType]) overrides[m.fieldType] = {};
      overrides[m.fieldType]![m.value.toLowerCase()] = {
        bg: m.bg,
        fg: m.fg,
      };
    }
    set({ colorOverrides: overrides });
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
