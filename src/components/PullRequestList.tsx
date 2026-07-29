import { useState, useEffect, useMemo, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { useThemeStore, autoFg } from '../stores/themeStore.js';
import {
  navigationStore,
  useNavigationStore,
} from '../stores/navigationStore.js';
import { useBackendDataStore } from '../stores/backendDataStore.js';
import { useShallow } from 'zustand/shallow';
import { uiStore, useUIStore } from '../stores/uiStore.js';
import { ColorPill } from './ColorPill.js';
import { CommandBar } from './CommandBar.js';
import { TableLayout } from './TableLayout.js';
import type { ColumnDef } from './TableLayout.js';
import type { PullRequest } from '../types.js';
import { useTerminalWidth } from '../hooks/useTerminalWidth.js';
import {
  getVisibleCommands,
  buildFooterHints,
  matchesCommand,
  type Command,
  type CommandContext,
} from '../commands.js';

const openInBrowser = async (url: string) => {
  const { default: open } = await import('open');
  await open(url);
};

function buildPrColumns(
  muted: string | undefined,
  mutedDim: boolean,
): ColumnDef<PullRequest>[] {
  return [
    {
      key: 'number',
      header: '#',
      width: 8,
      required: true,
      render: (pr, selected, rowBg) => (
        <Text color={rowBg ? autoFg(rowBg) : undefined} bold={selected}>
          #{pr.number}
        </Text>
      ),
    },
    {
      key: 'title',
      header: 'Title',
      width: -1,
      required: true,
      render: (pr, selected, rowBg) => (
        <Text
          color={rowBg ? autoFg(rowBg) : undefined}
          bold={selected}
          wrap="truncate"
        >
          {pr.title}
        </Text>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 12,
      hidePriority: 3,
      render: (pr, _selected, rowBg) => (
        <ColorPill field="status" value={pr.status} selectionBg={rowBg} />
      ),
    },
    {
      key: 'branches',
      header: 'Branches',
      width: 30,
      hidePriority: 2,
      render: (pr, selected, rowBg) => (
        <Text
          color={rowBg ? autoFg(rowBg) : muted}
          dimColor={!selected ? mutedDim : undefined}
          wrap="truncate"
        >
          {pr.sourceBranch} \u2192 {pr.targetBranch}
        </Text>
      ),
    },
    {
      key: 'author',
      header: 'Author',
      width: 16,
      hidePriority: 1,
      render: (pr, _selected, rowBg) => (
        <Text color={rowBg ? autoFg(rowBg) : undefined} wrap="truncate">
          {pr.author}
        </Text>
      ),
    },
    {
      key: 'links',
      header: 'Links',
      width: 6,
      hidePriority: 0,
      render: (pr, _selected, rowBg) => (
        <Text color={rowBg ? autoFg(rowBg) : undefined}>
          {pr.linkedItems.length > 0 ? String(pr.linkedItems.length) : ''}
        </Text>
      ),
    },
  ];
}

export function PullRequestList() {
  const { accent, muted, mutedDim } = useThemeStore((s) => s.colors);
  const { navigate, navigateToHelp } = navigationStore.getState();
  const selectedPrId = useNavigationStore((s) => s.selectedPrId);
  const { pullRequests, capabilities } = useBackendDataStore(
    useShallow((s) => ({
      pullRequests: s.pullRequests,
      capabilities: s.capabilities,
    })),
  );

  const termWidth = useTerminalWidth();
  const [cursor, setCursor] = useState(0);
  const activeOverlay = useUIStore((s) => s.activeOverlay);
  const { openOverlay, closeOverlay } = uiStore.getState();
  const prColumns = useMemo(
    () => buildPrColumns(muted, mutedDim),
    [muted, mutedDim],
  );

  // Set initial cursor from navigation
  useEffect(() => {
    if (selectedPrId) {
      const idx = pullRequests.findIndex((pr) => pr.id === selectedPrId);
      if (idx >= 0) setCursor(idx);
      navigationStore.getState().selectPr(null);
    }
  }, [selectedPrId, pullRequests]);

  // Clamp cursor to valid range
  const clampedCursor = Math.max(0, Math.min(cursor, pullRequests.length - 1));
  if (clampedCursor !== cursor) {
    setCursor(clampedCursor);
  }

  const currentPr = pullRequests[clampedCursor];

  // --- Action functions ---

  const doOpenInBrowser = useCallback(() => {
    if (currentPr?.url) {
      void openInBrowser(currentPr.url);
    }
  }, [currentPr]);

  // --- Command palette ---

  const commandContext: CommandContext = {
    screen: 'pr-list',
    markedCount: 0,
    hasSelectedItem: false,
    capabilities,
    types: [],
    activeType: null,
    hasSyncManager: false,
    gitAvailable: false,
    hasActiveFilters: false,
    hasSavedViews: false,
    hasSelectedBranch: false,
    isCurrentBranch: false,
    hasWorktree: false,
    hasPrCreateCapability: false,
    hasSelectedPr: currentPr !== undefined,
    showDetailDescription: false,
  };

  const paletteCommands = useMemo(
    () => getVisibleCommands(commandContext),
    [commandContext.hasSelectedPr],
  );

  const handleCommandSelect = useCallback(
    (cmd: Command) => {
      closeOverlay();
      switch (cmd.id) {
        case 'pr-open':
          doOpenInBrowser();
          break;
        case 'nav-back':
          navigate('list');
          break;
        case 'help':
          navigateToHelp();
          break;
      }
    },
    [closeOverlay, doOpenInBrowser, navigate, navigateToHelp],
  );

  useInput((input, key) => {
    if (activeOverlay) return;

    if (matchesCommand('nav-back', input, key)) {
      navigate('list');
      return;
    }

    if (matchesCommand('help', input, key)) {
      navigateToHelp();
      return;
    }

    if (matchesCommand('pr-search', input, key)) {
      openOverlay({ type: 'command-bar' });
      return;
    }

    // Navigation
    if (matchesCommand('pr-navigate', input, key)) {
      if (key.downArrow) {
        setCursor((c) => Math.min(c + 1, pullRequests.length - 1));
      } else {
        setCursor((c) => Math.max(c - 1, 0));
      }
      return;
    }

    // Open in browser
    if (matchesCommand('pr-open', input, key)) {
      doOpenInBrowser();
      return;
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color={accent}>
          Pull Requests
        </Text>
        <Text color={muted} dimColor={mutedDim}>
          {' '}
          ({pullRequests.length})
        </Text>
      </Box>

      {pullRequests.length === 0 ? (
        <Box>
          <Text color={muted} dimColor={mutedDim}>
            No pull requests
          </Text>
        </Box>
      ) : (
        <TableLayout
          items={pullRequests}
          columns={prColumns}
          cursor={clampedCursor}
          terminalWidth={termWidth}
          getKey={(pr) => pr.id}
        />
      )}

      {/* Footer keybinding hints */}
      <Box marginTop={1}>
        <Text color={muted} dimColor={mutedDim}>
          {buildFooterHints('pr-list', commandContext, termWidth)}
        </Text>
      </Box>

      {activeOverlay?.type === 'command-bar' && (
        <CommandBar
          commands={paletteCommands}
          onCommand={handleCommandSelect}
          onCancel={closeOverlay}
        />
      )}
    </Box>
  );
}
