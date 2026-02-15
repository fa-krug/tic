import { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { useThemeStore } from '../stores/themeStore.js';
import {
  navigationStore,
  useNavigationStore,
} from '../stores/navigationStore.js';
import { useBackendDataStore } from '../stores/backendDataStore.js';
import { uiStore } from '../stores/uiStore.js';
import { ColorPill } from './ColorPill.js';
import { CommandBar } from './CommandBar.js';
import { TableLayout } from './TableLayout.js';
import type { ColumnDef } from './TableLayout.js';
import type { PullRequest } from '../types.js';
import { useTerminalWidth } from '../hooks/useTerminalWidth.js';

const openInBrowser = async (url: string) => {
  const { default: open } = await import('open');
  await open(url);
};

function buildPrColumns(
  accent: string,
  muted: string | undefined,
  mutedDim: boolean,
): ColumnDef<PullRequest>[] {
  return [
    {
      key: 'number',
      header: '#',
      width: 8,
      required: true,
      render: (pr, selected) => (
        <Text color={selected ? accent : undefined} bold={selected}>
          #{pr.number}
        </Text>
      ),
    },
    {
      key: 'title',
      header: 'Title',
      width: -1,
      required: true,
      render: (pr, selected) => (
        <Text
          color={selected ? accent : undefined}
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
      render: (pr) => <ColorPill field="status" value={pr.status} />,
    },
    {
      key: 'branches',
      header: 'Branches',
      width: 30,
      hidePriority: 2,
      render: (pr, selected) => (
        <Text
          color={selected ? undefined : muted}
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
      render: (pr, selected) => (
        <Text color={selected ? accent : undefined} wrap="truncate">
          {pr.author}
        </Text>
      ),
    },
    {
      key: 'links',
      header: 'Links',
      width: 6,
      hidePriority: 0,
      render: (pr) => (
        <Text>
          {pr.linkedItems.length > 0 ? String(pr.linkedItems.length) : ''}
        </Text>
      ),
    },
  ];
}

export function PullRequestList() {
  const { accent, muted, mutedDim } = useThemeStore((s) => s.colors);
  const navigate = useNavigationStore((s) => s.navigate);
  const navigateToHelp = useNavigationStore((s) => s.navigateToHelp);
  const selectedPrId = useNavigationStore((s) => s.selectedPrId);
  const pullRequests = useBackendDataStore((s) => s.pullRequests);

  const termWidth = useTerminalWidth();
  const [cursor, setCursor] = useState(0);
  const { activeOverlay, openOverlay, closeOverlay } = uiStore.getState();
  const prColumns = useMemo(
    () => buildPrColumns(accent, muted, mutedDim),
    [accent, muted, mutedDim],
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

  useInput((input, key) => {
    if (activeOverlay) return;

    if (key.escape) {
      navigate('list');
      return;
    }

    if (input === '?') {
      navigateToHelp();
      return;
    }

    if (input === '/') {
      openOverlay({ type: 'command-bar' });
      return;
    }

    // Navigation
    if (input === 'j' || key.downArrow) {
      setCursor((c) => Math.min(c + 1, pullRequests.length - 1));
      return;
    }
    if (input === 'k' || key.upArrow) {
      setCursor((c) => Math.max(c - 1, 0));
      return;
    }

    // Open in browser
    if (key.return || input === 'o') {
      const pr = pullRequests[clampedCursor];
      if (pr?.url) {
        void openInBrowser(pr.url);
      }
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
          j/k navigate · Enter/o open in browser · / search · Esc back · ? help
        </Text>
      </Box>

      {activeOverlay?.type === 'command-bar' && (
        <CommandBar
          commands={[]}
          onCommand={() => closeOverlay()}
          onCancel={closeOverlay}
        />
      )}
    </Box>
  );
}
