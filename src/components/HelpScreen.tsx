import { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { useThemeStore } from '../stores/themeStore.js';
import { useNavigationStore, type Screen } from '../stores/navigationStore.js';
import { useBackendDataStore } from '../stores/backendDataStore.js';
import { isGitRepo } from '../git.js';
import type { BackendCapabilities } from '../backends/types.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import {
  getCommandsForScreen,
  groupByHelpGroup,
  matchesCommand,
  type ShortcutGroup,
  type CommandContext,
} from '../commands.js';

const SCREEN_LABELS: Record<string, string> = {
  list: 'List View',
  form: 'Form View',
  'pr-list': 'Pull Requests',
  'branch-list': 'Branches',
  settings: 'Settings',
  status: 'Status',
};

export function getShortcuts(
  screen: Screen,
  capabilities: BackendCapabilities,
  gitAvailable: boolean,
  hasSyncManager: boolean,
): ShortcutGroup[] {
  // Don't show shortcuts when viewing help screen itself
  if (screen === 'help') {
    return [];
  }

  const ctx: CommandContext = {
    screen,
    markedCount: 0,
    hasSelectedItem: true,
    capabilities,
    types: [],
    activeType: null,
    hasSyncManager,
    gitAvailable,
    hasActiveFilters: false,
    hasSavedViews: false,
    hasSelectedBranch: true,
    isCurrentBranch: false,
    hasWorktree: true,
    hasPrCreateCapability: true,
    hasSelectedPr: true,
  };
  return groupByHelpGroup(getCommandsForScreen(screen, ctx));
}

export type LineEntry =
  | { type: 'header'; label: string }
  | { type: 'shortcut'; key: string; description: string }
  | { type: 'gap' };

export function flattenGroups(groups: ShortcutGroup[]): LineEntry[] {
  const lines: LineEntry[] = [];
  for (const group of groups) {
    if (lines.length > 0) {
      lines.push({ type: 'gap' });
    }
    lines.push({ type: 'header', label: group.label });
    for (const s of group.shortcuts) {
      lines.push({ type: 'shortcut', key: s.key, description: s.description });
    }
  }
  return lines;
}

export function HelpScreen({ sourceScreen }: { sourceScreen: Screen }) {
  const { accent, mutedDim } = useThemeStore((s) => s.colors);
  const backend = useBackendDataStore((s) => s.backend);
  const syncManager = useBackendDataStore((s) => s.syncManager);
  const navigateBackFromHelp = useNavigationStore(
    (s) => s.navigateBackFromHelp,
  );
  const capabilities = backend?.getCapabilities() ?? {
    relationships: false,
    customTypes: false,
    customStatuses: false,
    iterations: false,
    comments: false,
    templates: false,
    fields: {
      priority: false,
      assignee: false,
      labels: false,
      parent: false,
      dependsOn: false,
    },
    templateFields: {
      type: false,
      status: false,
      priority: false,
      assignee: false,
      labels: false,
      iteration: false,
      parent: false,
      dependsOn: false,
      description: false,
    },
  };
  const gitAvailable = useMemo(() => isGitRepo(process.cwd()), []);
  const { height } = useTerminalSize();

  const groups = getShortcuts(
    sourceScreen,
    capabilities,
    gitAvailable,
    syncManager !== null,
  );

  const lines = useMemo(() => flattenGroups(groups), [groups]);

  // chrome: title(1) + margin(1) + footer(1) + margin(1) = 4
  const chromeLines = 4;
  const maxVisible = Math.max(1, height - chromeLines);
  const needsScroll = lines.length > maxVisible;
  const maxScroll = Math.max(0, lines.length - maxVisible);

  const [scrollOffset, setScrollOffset] = useState(0);

  useInput((input, key) => {
    if (matchesCommand('help-back', input, key)) {
      navigateBackFromHelp();
      return;
    }
    if (matchesCommand('help-scroll', input, key)) {
      if (key.upArrow) {
        setScrollOffset((o) => Math.max(0, o - 1));
      } else {
        setScrollOffset((o) => Math.min(maxScroll, o + 1));
      }
      return;
    }
  });

  const visibleLines = needsScroll
    ? lines.slice(scrollOffset, scrollOffset + maxVisible)
    : lines;

  const title = SCREEN_LABELS[sourceScreen] ?? 'Help';

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={accent}>
          Keyboard Shortcuts — {title}
        </Text>
      </Box>

      {visibleLines.map((line, idx) => {
        if (line.type === 'gap') {
          return <Box key={idx} height={1} />;
        }
        if (line.type === 'header') {
          return (
            <Text key={idx} bold>
              {line.label}:
            </Text>
          );
        }
        return (
          <Box key={idx} marginLeft={2}>
            <Box width={12}>
              <Text color={accent}>{line.key}</Text>
            </Box>
            <Text>{line.description}</Text>
          </Box>
        );
      })}

      <Box marginTop={1}>
        <Text dimColor={mutedDim}>
          {needsScroll
            ? `↑↓ scroll (${scrollOffset + 1}-${Math.min(scrollOffset + maxVisible, lines.length)} of ${lines.length})  esc: back`
            : 'esc: back'}
        </Text>
      </Box>
    </Box>
  );
}
