import { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { useThemeStore } from '../stores/themeStore.js';
import {
  navigationStore,
  useNavigationStore,
} from '../stores/navigationStore.js';
import {
  backendDataStore,
  useBackendDataStore,
} from '../stores/backendDataStore.js';
import { uiStore } from '../stores/uiStore.js';
import {
  getCurrentBranch,
  checkoutBranch,
  hasUncommittedChanges,
  createBranch,
} from '../git.js';
import {
  deleteBranch,
  mergeBranch,
  removeWorktree,
  pushBranch,
} from '../git-async.js';
import { spawnSync } from 'node:child_process';
import { CommandBar } from './CommandBar.js';

type Confirmation =
  | {
      type: 'delete';
      branch: string;
      worktreePath: string | null;
      unmerged: boolean;
    }
  | { type: 'merge'; branch: string; into: string }
  | { type: 'force-delete'; branch: string; worktreePath: string | null }
  | null;

type InputMode = 'normal' | 'new-branch';

export function BranchList() {
  const { accent, muted, mutedDim, warning } = useThemeStore((s) => s.colors);
  const navigate = useNavigationStore((s) => s.navigate);
  const navigateToHelp = useNavigationStore((s) => s.navigateToHelp);
  const selectedBranchName = useNavigationStore((s) => s.selectedBranchName);
  const rows = useBackendDataStore((s) => s.branches);
  const fetching = useBackendDataStore((s) => s.branchesLoading);
  const cwd = process.cwd();

  const [cursor, setCursor] = useState(0);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<InputMode>('normal');
  const [inputValue, setInputValue] = useState('');
  const { activeOverlay, openOverlay, closeOverlay } = uiStore.getState();

  // Trigger background fetch on mount
  useEffect(() => {
    backendDataStore.getState().refreshBranches();
  }, []);

  // Set initial cursor from navigation
  useEffect(() => {
    if (selectedBranchName) {
      const idx = rows.findIndex((r) => r.branch.name === selectedBranchName);
      if (idx >= 0) setCursor(idx);
      navigationStore.getState().selectBranch(null);
    }
  }, [selectedBranchName, rows]);

  // Clamp cursor
  const clampedCursor = Math.max(0, Math.min(cursor, rows.length - 1));
  if (clampedCursor !== cursor && rows.length > 0) {
    setCursor(clampedCursor);
  }

  // Auto-clear toast
  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  const showToast = (msg: string) => setToastMessage(msg);
  const reloadBranches = () => backendDataStore.getState().loadBranches();

  const currentRow = rows[clampedCursor];

  useInput((input, key) => {
    if (activeOverlay) return;

    // --- Confirmation mode ---
    if (confirmation) {
      if (input === 'y' || input === 'Y') {
        const conf = confirmation;
        setConfirmation(null);
        void (async () => {
          try {
            if (conf.type === 'delete' || conf.type === 'force-delete') {
              const force = conf.type === 'force-delete';
              if (conf.worktreePath) {
                await removeWorktree(conf.worktreePath, cwd, true);
              }
              await deleteBranch(conf.branch, cwd, force);
              showToast(`Deleted ${conf.branch}`);
              reloadBranches();
            } else if (conf.type === 'merge') {
              const result = await mergeBranch(conf.branch, cwd);
              if (result.success) {
                showToast(`Merged ${conf.branch} into ${conf.into}`);
                // Offer to delete merged branch
                const wt =
                  rows.find((r) => r.branch.name === conf.branch)?.worktree ??
                  null;
                setConfirmation({
                  type: 'delete',
                  branch: conf.branch,
                  worktreePath: wt?.path ?? null,
                  unmerged: false,
                });
              } else if (result.hasConflicts) {
                showToast('Merge conflicts — resolve in terminal');
              } else {
                showToast(`Merge failed: ${result.message}`);
              }
              reloadBranches();
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (
              conf.type === 'delete' &&
              !conf.unmerged &&
              msg.includes('not fully merged')
            ) {
              setConfirmation({
                type: 'force-delete',
                branch: conf.branch,
                worktreePath: conf.worktreePath,
              });
            } else {
              showToast(msg.split('\n')[0] ?? 'Error');
            }
          }
        })();
        return;
      }
      if (input === 'n' || input === 'N' || key.escape) {
        setConfirmation(null);
        return;
      }
      return; // block other input during confirmation
    }

    // --- Input mode (new branch name) ---
    if (inputMode !== 'normal') {
      if (key.escape) {
        setInputMode('normal');
        setInputValue('');
        return;
      }
      if (key.return) {
        if (inputMode === 'new-branch' && inputValue.trim()) {
          try {
            createBranch(inputValue.trim(), cwd);
            showToast(`Created branch ${inputValue.trim()}`);
            reloadBranches();
          } catch (err: unknown) {
            showToast(
              err instanceof Error ? err.message : 'Failed to create branch',
            );
          }
        }
        setInputMode('normal');
        setInputValue('');
        return;
      }
      if (key.backspace || key.delete) {
        setInputValue((v) => v.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setInputValue((v) => v + input);
        return;
      }
      return;
    }

    // --- Normal mode ---
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
      setCursor((c) => Math.min(c + 1, rows.length - 1));
      return;
    }
    if (input === 'k' || key.upArrow) {
      setCursor((c) => Math.max(c - 1, 0));
      return;
    }

    if (!currentRow) return;

    // Switch to branch
    if (key.return) {
      if (currentRow.branch.current) {
        showToast('Already on this branch');
        return;
      }
      if (hasUncommittedChanges(cwd)) {
        showToast('Uncommitted changes — stash or commit first');
        return;
      }
      try {
        checkoutBranch(currentRow.branch.name, cwd);
        showToast(`Switched to ${currentRow.branch.name}`);
        reloadBranches();
      } catch (err: unknown) {
        showToast(err instanceof Error ? err.message : 'Checkout failed');
      }
      return;
    }

    // Open worktree shell
    if (input === 'w') {
      if (!currentRow.worktree) {
        showToast('No worktree for this branch');
        return;
      }
      const shell = process.env['SHELL'] ?? '/bin/sh';
      process.stdin.setRawMode?.(false);
      spawnSync(shell, [], {
        cwd: currentRow.worktree.path,
        stdio: 'inherit',
        env: { ...process.env },
      });
      process.stdin.setRawMode?.(true);
      reloadBranches();
      return;
    }

    // Delete branch
    if (input === 'd') {
      if (currentRow.branch.current) {
        showToast('Cannot delete current branch');
        return;
      }
      setConfirmation({
        type: 'delete',
        branch: currentRow.branch.name,
        worktreePath: currentRow.worktree?.path ?? null,
        unmerged: false,
      });
      return;
    }

    // Merge branch
    if (input === 'm') {
      if (currentRow.branch.current) {
        showToast('Cannot merge current branch into itself');
        return;
      }
      const currentBranch = getCurrentBranch(cwd) ?? 'current branch';
      setConfirmation({
        type: 'merge',
        branch: currentRow.branch.name,
        into: currentBranch,
      });
      return;
    }

    // Push branch
    if (input === 'P') {
      void (async () => {
        try {
          showToast(`Pushing ${currentRow.branch.name}...`);
          await pushBranch(currentRow.branch.name, cwd);
          showToast(`Pushed ${currentRow.branch.name}`);
          reloadBranches();
        } catch (err: unknown) {
          showToast(err instanceof Error ? err.message : 'Push failed');
        }
      })();
      return;
    }

    // Create PR
    if (input === 'p') {
      showToast('PR creation — use p from list view');
      return;
    }

    // Refresh
    if (input === 'r') {
      backendDataStore.getState().refreshBranches();
      return;
    }

    // New branch
    if (input === 'n') {
      setInputMode('new-branch');
      setInputValue('');
      return;
    }
  });

  // --- Time formatting helper ---
  const relativeTime = (isoDate: string): string => {
    if (!isoDate) return '';
    const diff = Date.now() - new Date(isoDate).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  // --- Render ---
  return (
    <Box flexDirection="column" padding={1}>
      {/* Title */}
      <Box marginBottom={1}>
        <Text bold color={accent}>
          Branches
        </Text>
        <Text color={muted} dimColor={mutedDim}>
          {' '}
          ({rows.length})
        </Text>
        {fetching && (
          <Text color={warning}>
            {' '}
            <Spinner type="dots" /> Fetching...
          </Text>
        )}
      </Box>

      {/* Input prompts */}
      {inputMode === 'new-branch' && (
        <Box marginBottom={1}>
          <Text color={accent}>New branch name: </Text>
          <Text>{inputValue}</Text>
          <Text color={muted} dimColor={mutedDim}>
            █
          </Text>
        </Box>
      )}

      {/* Confirmation dialog */}
      {confirmation && (
        <Box marginBottom={1}>
          <Text color={warning}>
            {confirmation.type === 'delete' &&
              `Delete branch "${confirmation.branch}"?` +
                (confirmation.worktreePath
                  ? ` This will also remove worktree at ${confirmation.worktreePath}.`
                  : '')}
            {confirmation.type === 'force-delete' &&
              `Branch "${confirmation.branch}" is not fully merged. Force delete?` +
                (confirmation.worktreePath
                  ? ` This will also remove worktree at ${confirmation.worktreePath}.`
                  : '')}
            {confirmation.type === 'merge' &&
              `Merge "${confirmation.branch}" into "${confirmation.into}"?`}
            {' (y/n)'}
          </Text>
        </Box>
      )}

      {rows.length === 0 ? (
        <Box>
          <Text color={muted} dimColor={mutedDim}>
            No branches
          </Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {/* Header row */}
          <Box>
            <Box width={32}>
              <Text bold color={muted} dimColor={mutedDim}>
                Branch
              </Text>
            </Box>
            <Box width={30}>
              <Text bold color={muted} dimColor={mutedDim}>
                Item
              </Text>
            </Box>
            <Box width={20}>
              <Text bold color={muted} dimColor={mutedDim}>
                Worktree
              </Text>
            </Box>
            <Box width={10}>
              <Text bold color={muted} dimColor={mutedDim}>
                Remote
              </Text>
            </Box>
            <Box width={10}>
              <Text bold color={muted} dimColor={mutedDim}>
                Last Commit
              </Text>
            </Box>
          </Box>

          {/* Data rows */}
          {rows.map((row, index) => {
            const isSelected = index === clampedCursor;
            const isTic = row.branch.name.startsWith('tic/');
            const prefix = row.branch.current ? '* ' : '  ';
            const branchDisplay = prefix + row.branch.name;
            const truncBranch =
              branchDisplay.length > 30
                ? branchDisplay.slice(0, 30) + '\u2026'
                : branchDisplay;

            const itemDisplay = row.linkedItem
              ? `#${row.linkedItem.id} ${row.linkedItem.title}`
              : '';
            const truncItem =
              itemDisplay.length > 28
                ? itemDisplay.slice(0, 28) + '\u2026'
                : itemDisplay;

            const wtDisplay = row.worktree ? '\u2713' : '';

            let remoteDisplay = '--';
            if (row.branch.upstream) {
              const parts: string[] = [];
              if (row.branch.ahead > 0) parts.push(`\u2191${row.branch.ahead}`);
              if (row.branch.behind > 0)
                parts.push(`\u2193${row.branch.behind}`);
              remoteDisplay = parts.length > 0 ? parts.join(' ') : '\u2713';
            }

            return (
              <Box key={row.branch.name}>
                <Box width={32}>
                  <Text
                    inverse={isSelected}
                    bold={isSelected || isTic}
                    color={isTic && !isSelected ? accent : undefined}
                  >
                    {truncBranch}
                  </Text>
                </Box>
                <Box width={30}>
                  <Text
                    inverse={isSelected}
                    color={
                      row.linkedItem
                        ? isSelected
                          ? undefined
                          : muted
                        : undefined
                    }
                    dimColor={!row.linkedItem ? mutedDim : undefined}
                  >
                    {truncItem}
                  </Text>
                </Box>
                <Box width={20}>
                  <Text inverse={isSelected}>{wtDisplay}</Text>
                </Box>
                <Box width={10}>
                  <Text inverse={isSelected}>{remoteDisplay}</Text>
                </Box>
                <Box width={10}>
                  <Text inverse={isSelected} color={muted} dimColor={mutedDim}>
                    {relativeTime(row.branch.lastCommitDate)}
                  </Text>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}

      {/* Toast */}
      {toastMessage && (
        <Box marginTop={1}>
          <Text color={warning}>{toastMessage}</Text>
        </Box>
      )}

      {/* Footer keybinding hints */}
      <Box marginTop={1}>
        <Text color={muted} dimColor={mutedDim}>
          j/k navigate {'\u00b7'} Enter switch {'\u00b7'} d delete {'\u00b7'} m
          merge {'\u00b7'} P push {'\u00b7'} n new {'\u00b7'} w worktree{' '}
          {'\u00b7'} r refresh {'\u00b7'} / search {'\u00b7'} Esc back{' '}
          {'\u00b7'} ? help
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
