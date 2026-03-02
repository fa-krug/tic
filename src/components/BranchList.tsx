import { useState, useEffect, useMemo, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { TableLayout } from './TableLayout.js';
import type { ColumnDef } from './TableLayout.js';
import type { BranchRow } from '../git.js';
import { useThemeStore, autoFg } from '../stores/themeStore.js';
import {
  navigationStore,
  useNavigationStore,
} from '../stores/navigationStore.js';
import {
  backendDataStore,
  useBackendDataStore,
} from '../stores/backendDataStore.js';
import { uiStore, useUIStore } from '../stores/uiStore.js';
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
import { OverlayPanel } from './OverlayPanel.js';
import { useTerminalWidth } from '../hooks/useTerminalWidth.js';
import {
  getVisibleCommands,
  buildFooterHints,
  matchesCommand,
  type Command,
  type CommandContext,
} from '../commands.js';

type InputMode = 'normal' | 'new-branch';

function relativeTime(isoDate: string): string {
  if (!isoDate) return '';
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function buildBranchColumns(
  accent: string,
  muted: string | undefined,
  mutedDim: boolean,
  selectionBg: string,
): ColumnDef<BranchRow>[] {
  return [
    {
      key: 'branch',
      header: 'Branch',
      width: -1, // flex
      required: true,
      render: (row, selected) => {
        const isTic = row.branch.name.startsWith('tic/');
        const prefix = row.branch.current ? '* ' : '  ';
        return (
          <Text
            color={selected ? autoFg(selectionBg) : isTic ? accent : undefined}
            bold={selected || isTic}
            wrap="truncate"
          >
            {prefix}
            {row.branch.name}
          </Text>
        );
      },
    },
    {
      key: 'item',
      header: 'Item',
      width: 30,
      hidePriority: 3,
      render: (row, selected) => {
        const display = row.linkedItem
          ? `#${row.linkedItem.id} ${row.linkedItem.title}`
          : '';
        return (
          <Text
            color={row.linkedItem ? (selected ? undefined : muted) : undefined}
            dimColor={!row.linkedItem ? mutedDim : undefined}
            wrap="truncate"
          >
            {display}
          </Text>
        );
      },
    },
    {
      key: 'worktree',
      header: 'Worktree',
      width: 10,
      hidePriority: 1,
      render: (row) => <Text>{row.worktree ? '\u2713' : ''}</Text>,
    },
    {
      key: 'remote',
      header: 'Remote',
      width: 10,
      hidePriority: 2,
      render: (row) => {
        if (!row.branch.upstream) return <Text>--</Text>;
        const parts: string[] = [];
        if (row.branch.ahead > 0) parts.push(`\u2191${row.branch.ahead}`);
        if (row.branch.behind > 0) parts.push(`\u2193${row.branch.behind}`);
        return <Text>{parts.length > 0 ? parts.join(' ') : '\u2713'}</Text>;
      },
    },
    {
      key: 'time',
      header: 'Last Commit',
      width: 10,
      hidePriority: 0,
      render: (row, selected) => (
        <Text
          color={selected ? undefined : muted}
          dimColor={!selected ? mutedDim : undefined}
        >
          {relativeTime(row.branch.lastCommitDate)}
        </Text>
      ),
    },
  ];
}

export function BranchList() {
  const { accent, muted, mutedDim, warning, selectionBg } = useThemeStore(
    (s) => s.colors,
  );
  const navigate = useNavigationStore((s) => s.navigate);
  const navigateToHelp = useNavigationStore((s) => s.navigateToHelp);
  const selectedBranchName = useNavigationStore((s) => s.selectedBranchName);
  const rows = useBackendDataStore((s) => s.branches);
  const prCapabilities = useBackendDataStore((s) => s.prCapabilities);
  const capabilities = useBackendDataStore((s) => s.capabilities);
  const cwd = process.cwd();
  const termWidth = useTerminalWidth();
  const branchColumns = useMemo(
    () => buildBranchColumns(accent, muted, mutedDim, selectionBg),
    [accent, muted, mutedDim, selectionBg],
  );

  const [cursor, setCursor] = useState(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<InputMode>('normal');
  const [inputValue, setInputValue] = useState('');
  const activeOverlay = useUIStore((s) => s.activeOverlay);
  const { openOverlay, closeOverlay } = uiStore.getState();

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
    const timer = setTimeout(() => setToastMessage(null), 10000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  const showToast = (msg: string) => setToastMessage(msg);
  const reloadBranches = () => backendDataStore.getState().loadBranches();

  const currentRow = rows[clampedCursor];

  // --- Action functions (shared between useInput and command palette) ---

  const doSwitch = useCallback(() => {
    if (!currentRow) return;
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
  }, [currentRow, cwd]);

  const doWorktree = useCallback(() => {
    if (!currentRow) return;
    if (!currentRow.worktree) {
      showToast('No worktree for this branch');
      return;
    }
    const shell = process.env['SHELL'] ?? '/bin/sh';
    // Strip Node.js debug env vars so child processes don't inherit debugger settings
    const env: Record<string, string | undefined> = { ...process.env };
    delete env['NODE_OPTIONS'];
    delete env['NODE_INSPECT_PUBLISH_UID'];
    process.stdin.setRawMode?.(false);
    spawnSync(shell, [], {
      cwd: currentRow.worktree.path,
      stdio: 'inherit',
      env,
    });
    process.stdin.setRawMode?.(true);
    console.clear();
    reloadBranches();
  }, [currentRow]);

  const doDelete = useCallback(() => {
    if (!currentRow) return;
    if (currentRow.branch.current) {
      showToast('Cannot delete current branch');
      return;
    }
    openOverlay({
      type: 'branch-delete-confirm',
      branch: currentRow.branch.name,
      worktreePath: currentRow.worktree?.path ?? null,
    });
  }, [currentRow, openOverlay]);

  const doMerge = useCallback(() => {
    if (!currentRow) return;
    if (currentRow.branch.current) {
      showToast('Cannot merge current branch into itself');
      return;
    }
    const currentBranch = getCurrentBranch(cwd) ?? 'current branch';
    openOverlay({
      type: 'branch-merge-confirm',
      branch: currentRow.branch.name,
      into: currentBranch,
    });
  }, [currentRow, cwd, openOverlay]);

  const doPush = useCallback(() => {
    if (!currentRow) return;
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
  }, [currentRow, cwd]);

  const doCreatePr = useCallback(() => {
    if (!currentRow) return;
    const { prCapabilities: prCaps, createPullRequest } =
      backendDataStore.getState();
    if (!prCaps.create) {
      showToast('Backend does not support PR creation');
      return;
    }
    if (currentRow.branch.current) {
      showToast('Cannot create PR from current branch');
      return;
    }
    const title = currentRow.linkedItem
      ? currentRow.linkedItem.title
      : currentRow.branch.name;
    const linkedItems = currentRow.linkedItem ? [currentRow.linkedItem.id] : [];
    void createPullRequest({
      title,
      sourceBranch: currentRow.branch.name,
      linkedItems,
    })
      .then((pr) => {
        showToast(`PR #${String(pr.number)} created`);
        backendDataStore
          .getState()
          .loadPullRequests()
          .catch(() => {});
      })
      .catch((err: unknown) => {
        showToast(err instanceof Error ? err.message : 'Failed to create PR');
      });
  }, [currentRow]);

  const doRefresh = useCallback(() => {
    backendDataStore.getState().refreshBranches();
  }, []);

  const doCreateBranch = useCallback(() => {
    setInputMode('new-branch');
    setInputValue('');
  }, []);

  // --- Command palette ---

  const commandContext: CommandContext = {
    screen: 'branch-list',
    markedCount: 0,
    hasSelectedItem: false,
    capabilities,
    types: [],
    activeType: null,
    hasSyncManager: false,
    gitAvailable: true,
    hasActiveFilters: false,
    hasSavedViews: false,
    hasSelectedBranch: currentRow !== undefined,
    isCurrentBranch: currentRow?.branch.current ?? false,
    hasWorktree:
      currentRow?.worktree !== undefined && currentRow?.worktree !== null,
    hasPrCreateCapability: prCapabilities.create,
    hasSelectedPr: false,
  };

  const paletteCommands = useMemo(
    () => getVisibleCommands(commandContext),
    [
      commandContext.hasSelectedBranch,
      commandContext.isCurrentBranch,
      commandContext.hasWorktree,
      prCapabilities.create,
    ],
  );

  const handleCommandSelect = useCallback(
    (cmd: Command) => {
      closeOverlay();
      switch (cmd.id) {
        case 'branch-switch':
          doSwitch();
          break;
        case 'branch-create':
          doCreateBranch();
          break;
        case 'branch-delete':
          doDelete();
          break;
        case 'branch-merge':
          doMerge();
          break;
        case 'branch-push':
          doPush();
          break;
        case 'branch-create-pr':
          doCreatePr();
          break;
        case 'branch-worktree':
          doWorktree();
          break;
        case 'branch-refresh':
          doRefresh();
          break;
        case 'nav-back':
          navigate('list');
          break;
        case 'help':
          navigateToHelp();
          break;
      }
    },
    [
      closeOverlay,
      doSwitch,
      doCreateBranch,
      doDelete,
      doMerge,
      doPush,
      doCreatePr,
      doWorktree,
      doRefresh,
      navigate,
      navigateToHelp,
    ],
  );

  useInput((input, key) => {
    if (activeOverlay) return;

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
    if (matchesCommand('nav-back', input, key)) {
      navigate('list');
      return;
    }

    if (matchesCommand('help', input, key)) {
      navigateToHelp();
      return;
    }

    if (matchesCommand('branch-search', input, key)) {
      openOverlay({ type: 'command-bar' });
      return;
    }

    // Navigation
    if (matchesCommand('branch-navigate', input, key)) {
      if (key.downArrow) {
        setCursor((c) => Math.min(c + 1, rows.length - 1));
      } else {
        setCursor((c) => Math.max(c - 1, 0));
      }
      return;
    }

    if (!currentRow) return;

    if (matchesCommand('branch-switch', input, key)) {
      doSwitch();
      return;
    }
    if (matchesCommand('branch-worktree', input, key)) {
      doWorktree();
      return;
    }
    if (matchesCommand('branch-delete', input, key)) {
      doDelete();
      return;
    }
    if (matchesCommand('branch-merge', input, key)) {
      doMerge();
      return;
    }
    if (matchesCommand('branch-push', input, key)) {
      doPush();
      return;
    }
    if (matchesCommand('branch-create-pr', input, key)) {
      doCreatePr();
      return;
    }
    if (matchesCommand('branch-refresh', input, key)) {
      doRefresh();
      return;
    }
    if (matchesCommand('branch-create', input, key)) {
      doCreateBranch();
      return;
    }
  });

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

      {rows.length === 0 ? (
        <Box>
          <Text color={muted} dimColor={mutedDim}>
            No branches
          </Text>
        </Box>
      ) : (
        <TableLayout
          items={rows}
          columns={branchColumns}
          cursor={clampedCursor}
          terminalWidth={termWidth}
          getKey={(row) => row.branch.name}
        />
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
          {buildFooterHints('branch-list', commandContext, termWidth)}
        </Text>
      </Box>

      {activeOverlay?.type === 'command-bar' && (
        <CommandBar
          commands={paletteCommands}
          onCommand={handleCommandSelect}
          onCancel={closeOverlay}
        />
      )}

      {activeOverlay?.type === 'branch-delete-confirm' && (
        <OverlayPanel
          title={`Delete "${activeOverlay.branch}"?${activeOverlay.worktreePath ? ' (worktree will also be removed)' : ''}`}
          items={[
            { id: 'yes', label: 'Yes, delete', value: 'yes' },
            { id: 'no', label: 'Cancel', value: 'no' },
          ]}
          onSelect={(item) => {
            if (item.value === 'yes') {
              const { branch, worktreePath } = activeOverlay;
              closeOverlay();
              void (async () => {
                try {
                  if (worktreePath) {
                    await removeWorktree(worktreePath, cwd, true);
                  }
                  await deleteBranch(branch, cwd, false);
                  showToast(`Deleted ${branch}`);
                  reloadBranches();
                } catch (err: unknown) {
                  const msg = err instanceof Error ? err.message : String(err);
                  if (msg.includes('not fully merged')) {
                    openOverlay({
                      type: 'branch-force-delete-confirm',
                      branch,
                      worktreePath,
                    });
                  } else {
                    showToast(msg.split('\n')[0] ?? 'Error');
                  }
                }
              })();
            } else {
              closeOverlay();
            }
          }}
          onCancel={() => closeOverlay()}
        />
      )}

      {activeOverlay?.type === 'branch-force-delete-confirm' && (
        <OverlayPanel
          title={`"${activeOverlay.branch}" is not fully merged. Force delete?`}
          items={[
            { id: 'yes', label: 'Yes, force delete', value: 'yes' },
            { id: 'no', label: 'Cancel', value: 'no' },
          ]}
          onSelect={(item) => {
            if (item.value === 'yes') {
              const { branch, worktreePath } = activeOverlay;
              closeOverlay();
              void (async () => {
                try {
                  if (worktreePath) {
                    await removeWorktree(worktreePath, cwd, true);
                  }
                  await deleteBranch(branch, cwd, true);
                  showToast(`Deleted ${branch}`);
                  reloadBranches();
                } catch (err: unknown) {
                  showToast(
                    err instanceof Error
                      ? (err.message.split('\n')[0] ?? 'Error')
                      : 'Error',
                  );
                }
              })();
            } else {
              closeOverlay();
            }
          }}
          onCancel={() => closeOverlay()}
        />
      )}

      {activeOverlay?.type === 'branch-merge-confirm' && (
        <OverlayPanel
          title={`Merge "${activeOverlay.branch}" into "${activeOverlay.into}"?`}
          items={[
            { id: 'yes', label: 'Yes, merge', value: 'yes' },
            { id: 'no', label: 'Cancel', value: 'no' },
          ]}
          onSelect={(item) => {
            if (item.value === 'yes') {
              const { branch } = activeOverlay;
              closeOverlay();
              void (async () => {
                try {
                  const result = await mergeBranch(branch, cwd);
                  if (result.success) {
                    showToast(`Merged ${branch} into ${activeOverlay.into}`);
                    const wt =
                      rows.find((r) => r.branch.name === branch)?.worktree ??
                      null;
                    openOverlay({
                      type: 'branch-delete-confirm',
                      branch,
                      worktreePath: wt?.path ?? null,
                    });
                  } else if (result.hasConflicts) {
                    showToast('Merge conflicts — resolve in terminal');
                  } else {
                    showToast(`Merge failed: ${result.message}`);
                  }
                  reloadBranches();
                } catch (err: unknown) {
                  showToast(
                    err instanceof Error ? err.message : 'Merge failed',
                  );
                }
              })();
            } else {
              closeOverlay();
            }
          }}
          onCancel={() => closeOverlay()}
        />
      )}
    </Box>
  );
}
