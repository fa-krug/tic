import { useState, useEffect } from 'react';
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

const openInBrowser = async (url: string) => {
  const { default: open } = await import('open');
  await open(url);
};

export function PullRequestList() {
  const { accent, muted, mutedDim } = useThemeStore((s) => s.colors);
  const navigate = useNavigationStore((s) => s.navigate);
  const navigateToHelp = useNavigationStore((s) => s.navigateToHelp);
  const selectedPrId = useNavigationStore((s) => s.selectedPrId);
  const pullRequests = useBackendDataStore((s) => s.pullRequests);

  const [cursor, setCursor] = useState(0);
  const { activeOverlay, openOverlay, closeOverlay } = uiStore.getState();

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
        <Box flexDirection="column">
          {/* Header row */}
          <Box>
            <Box width={8}>
              <Text bold color={muted} dimColor={mutedDim}>
                #
              </Text>
            </Box>
            <Box width={40}>
              <Text bold color={muted} dimColor={mutedDim}>
                Title
              </Text>
            </Box>
            <Box width={12}>
              <Text bold color={muted} dimColor={mutedDim}>
                Status
              </Text>
            </Box>
            <Box width={30}>
              <Text bold color={muted} dimColor={mutedDim}>
                Branches
              </Text>
            </Box>
            <Box width={16}>
              <Text bold color={muted} dimColor={mutedDim}>
                Author
              </Text>
            </Box>
            <Box width={6}>
              <Text bold color={muted} dimColor={mutedDim}>
                Links
              </Text>
            </Box>
          </Box>

          {/* Data rows */}
          {pullRequests.map((pr, index) => {
            const isSelected = index === clampedCursor;
            const title =
              pr.title.length > 37 ? pr.title.slice(0, 37) + '...' : pr.title;
            const branches = `${pr.sourceBranch} → ${pr.targetBranch}`;
            const branchesDisplay =
              branches.length > 27 ? branches.slice(0, 27) + '...' : branches;

            return (
              <Box key={pr.id}>
                <Box width={8}>
                  <Text inverse={isSelected} bold={isSelected}>
                    #{pr.number}
                  </Text>
                </Box>
                <Box width={40}>
                  <Text inverse={isSelected} bold={isSelected}>
                    {title}
                  </Text>
                </Box>
                <Box width={12}>
                  {isSelected ? (
                    <Text inverse>{pr.status}</Text>
                  ) : (
                    <ColorPill field="status" value={pr.status} />
                  )}
                </Box>
                <Box width={30}>
                  <Text inverse={isSelected} color={muted} dimColor={mutedDim}>
                    {branchesDisplay}
                  </Text>
                </Box>
                <Box width={16}>
                  <Text inverse={isSelected}>{pr.author}</Text>
                </Box>
                <Box width={6}>
                  <Text inverse={isSelected}>
                    {pr.linkedItems.length > 0
                      ? String(pr.linkedItems.length)
                      : ''}
                  </Text>
                </Box>
              </Box>
            );
          })}
        </Box>
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
