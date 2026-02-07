import { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { useNavigationStore, type Screen } from '../stores/navigationStore.js';
import { useBackendDataStore } from '../stores/backendDataStore.js';
import { isGitRepo } from '../git.js';
import type { BackendCapabilities } from '../backends/types.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';

interface ShortcutEntry {
  key: string;
  description: string;
}

interface ShortcutGroup {
  label: string;
  shortcuts: ShortcutEntry[];
}

const SCREEN_LABELS: Record<string, string> = {
  list: 'List View',
  form: 'Form View',
  'iteration-picker': 'Iteration Picker',
  settings: 'Settings',
  status: 'Status',
};

export function getShortcuts(
  screen: Screen,
  capabilities: BackendCapabilities,
  gitAvailable: boolean,
  hasSyncManager: boolean,
): ShortcutGroup[] {
  switch (screen) {
    case 'list': {
      const nav: ShortcutEntry[] = [
        { key: '\u2191/\u2193', description: 'Navigate items' },
        { key: 'pgup/pgdn', description: 'Page up / page down' },
        { key: 'home/end', description: 'Jump to first / last item' },
      ];
      if (capabilities.relationships) {
        nav.push({ key: '\u2190', description: 'Collapse or jump to parent' });
        nav.push({ key: '\u2192', description: 'Expand children' });
      }

      const actions: ShortcutEntry[] = [
        { key: 'enter', description: 'Edit item' },
        { key: 'c', description: 'Create item (template picker if available)' },
        { key: 'd', description: 'Delete item' },
        { key: 'o', description: 'Open in browser' },
        { key: 's', description: 'Status screen' },
      ];
      actions.push({ key: '/', description: 'Quick search' });
      actions.push({ key: ':', description: 'Command palette' });
      if (capabilities.fields.parent) {
        actions.push({ key: 'p', description: 'Set parent' });
      }
      actions.push({ key: 'm', description: 'Toggle mark' });
      actions.push({ key: 'M', description: 'Clear all marks' });
      actions.push({ key: 'B', description: 'Bulk actions menu' });
      if (capabilities.customTypes) {
        actions.push({ key: 't', description: 'Set type' });
      }
      if (capabilities.fields.priority) {
        actions.push({ key: 'P', description: 'Set priority' });
      }
      if (capabilities.fields.assignee) {
        actions.push({ key: 'a', description: 'Set assignee' });
      }
      if (capabilities.fields.labels) {
        actions.push({ key: 'l', description: 'Set labels' });
      }

      const switching: ShortcutEntry[] = [];
      if (capabilities.customTypes) {
        switching.push({ key: 'tab', description: 'Cycle work item type' });
      }
      if (capabilities.iterations) {
        switching.push({ key: 'i', description: 'Iteration picker' });
      }
      switching.push({ key: ',', description: 'Settings' });

      const other: ShortcutEntry[] = [];
      other.push({ key: 'v', description: 'Toggle detail panel' });
      if (hasSyncManager) {
        other.push({ key: 'r', description: 'Sync' });
      }
      if (gitAvailable) {
        other.push({ key: 'b', description: 'Branch / worktree' });
      }
      other.push({ key: 'q', description: 'Quit' });

      const groups: ShortcutGroup[] = [
        { label: 'Navigation', shortcuts: nav },
        { label: 'Actions', shortcuts: actions },
      ];
      if (switching.length > 0) {
        groups.push({ label: 'Switching', shortcuts: switching });
      }
      groups.push({ label: 'Other', shortcuts: other });
      return groups;
    }

    case 'form': {
      return [
        {
          label: 'Navigation',
          shortcuts: [
            { key: '\u2191/\u2193', description: 'Move between fields' },
          ],
        },
        {
          label: 'Editing',
          shortcuts: [
            {
              key: 'enter',
              description:
                'Edit field / open $EDITOR (description) / navigate to related item',
            },
            {
              key: 'esc',
              description: 'revert field to previous value (in edit mode)',
            },
            {
              key: 'enter/select',
              description: 'Confirm field value',
            },
          ],
        },
        {
          label: 'Save & Exit',
          shortcuts: [
            {
              key: 'ctrl+s',
              description: 'Save and go back',
            },
            {
              key: 'esc',
              description:
                'Go back (prompts to save/discard if unsaved changes)',
            },
          ],
        },
      ];
    }

    case 'iteration-picker': {
      return [
        {
          label: 'Navigation',
          shortcuts: [
            { key: '\u2191/\u2193', description: 'Navigate iterations' },
            { key: 'enter', description: 'Select iteration' },
          ],
        },
      ];
    }

    case 'settings': {
      return [
        {
          label: 'Navigation',
          shortcuts: [
            { key: '\u2191/\u2193', description: 'Navigate options' },
            { key: 'enter', description: 'Select or edit' },
            { key: 'esc/,', description: 'Go back' },
          ],
        },
        {
          label: 'Editing',
          shortcuts: [
            { key: 'type', description: 'Edit field value' },
            { key: 'enter/esc', description: 'Confirm' },
          ],
        },
        ...(capabilities.templates
          ? [
              {
                label: 'Templates',
                shortcuts: [
                  { key: 'enter', description: 'Edit template' },
                  { key: 'c', description: 'Create template' },
                  { key: 'd', description: 'Delete template' },
                ],
              },
            ]
          : []),
      ];
    }

    case 'status': {
      return [
        {
          label: 'Navigation',
          shortcuts: [
            { key: '\u2191/\u2193', description: 'Scroll errors' },
            { key: 'esc/q', description: 'Go back' },
          ],
        },
      ];
    }

    default:
      return [];
  }
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

  useInput((_input, key) => {
    if (key.escape) {
      navigateBackFromHelp();
      return;
    }
    if (key.upArrow) {
      setScrollOffset((o) => Math.max(0, o - 1));
    }
    if (key.downArrow) {
      setScrollOffset((o) => Math.min(maxScroll, o + 1));
    }
  });

  const visibleLines = needsScroll
    ? lines.slice(scrollOffset, scrollOffset + maxVisible)
    : lines;

  const title = SCREEN_LABELS[sourceScreen] ?? 'Help';

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">
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
              <Text color="cyan">{line.key}</Text>
            </Box>
            <Text>{line.description}</Text>
          </Box>
        );
      })}

      <Box marginTop={1}>
        <Text dimColor>
          {needsScroll
            ? `↑↓ scroll (${scrollOffset + 1}-${Math.min(scrollOffset + maxVisible, lines.length)} of ${lines.length})  esc: back`
            : 'esc: back'}
        </Text>
      </Box>
    </Box>
  );
}
