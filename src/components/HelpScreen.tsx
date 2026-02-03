import { useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { useAppState } from '../app.js';
import type { Screen } from '../app.js';
import { isGitRepo } from '../git.js';
import type { BackendCapabilities } from '../backends/types.js';

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
      ];
      if (capabilities.relationships) {
        nav.push({ key: '\u2190', description: 'Collapse or jump to parent' });
        nav.push({ key: '\u2192', description: 'Expand children' });
      }

      const actions: ShortcutEntry[] = [
        { key: 'enter', description: 'Edit item' },
        { key: 'c', description: 'Create new item' },
        { key: 'd', description: 'Delete item' },
        { key: 'o', description: 'Open in browser' },
        { key: 's', description: 'Status screen' },
      ];
      actions.push({ key: '/', description: 'Quick search' });
      if (capabilities.fields.parent) {
        actions.push({ key: 'p', description: 'Set parent' });
      }
      actions.push({ key: 'm', description: 'Toggle mark' });
      actions.push({ key: 'M', description: 'Clear all marks' });
      actions.push({ key: 'b', description: 'Bulk actions menu' });
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
      if (hasSyncManager) {
        other.push({ key: 'r', description: 'Sync' });
      }
      if (gitAvailable) {
        other.push({ key: 'B', description: 'Branch / worktree' });
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
              description: 'Edit field / open related item',
            },
            {
              key: 'esc',
              description: 'Confirm edit (text) or cancel (select)',
            },
          ],
        },
        {
          label: 'Save',
          shortcuts: [
            {
              key: 'esc',
              description: 'Save and go back (in navigation mode)',
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

export function HelpScreen({ sourceScreen }: { sourceScreen: Screen }) {
  const { backend, syncManager, navigateBackFromHelp } = useAppState();
  const capabilities = backend.getCapabilities();
  const gitAvailable = useMemo(() => isGitRepo(process.cwd()), []);

  const groups = getShortcuts(
    sourceScreen,
    capabilities,
    gitAvailable,
    syncManager !== null,
  );

  useInput((_input, key) => {
    if (key.escape) {
      navigateBackFromHelp();
    }
  });

  const title = SCREEN_LABELS[sourceScreen] ?? 'Help';

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Keyboard Shortcuts — {title}
        </Text>
      </Box>

      {groups.map((group) => (
        <Box key={group.label} flexDirection="column" marginBottom={1}>
          <Text bold>{group.label}:</Text>
          {group.shortcuts.map((shortcut) => (
            <Box key={shortcut.key} marginLeft={2}>
              <Box width={12}>
                <Text color="cyan">{shortcut.key}</Text>
              </Box>
              <Text>{shortcut.description}</Text>
            </Box>
          ))}
        </Box>
      ))}

      <Box marginTop={1}>
        <Text dimColor>esc: back</Text>
      </Box>
    </Box>
  );
}
