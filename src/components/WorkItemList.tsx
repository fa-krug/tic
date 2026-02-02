import { useState, useMemo, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { useAppState } from '../app.js';
import { isGitRepo } from '../git.js';
import { beginImplementation } from '../implement.js';
import { readConfigSync } from '../backends/local/config.js';
import { TableLayout } from './TableLayout.js';
import { CardLayout } from './CardLayout.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { useScrollViewport } from '../hooks/useScrollViewport.js';
import { useBackendData } from '../hooks/useBackendData.js';
import { SyncQueueStore } from '../sync/queue.js';
import type { SyncStatus, QueueAction } from '../sync/types.js';
import { buildTree } from './buildTree.js';
export type { TreeItem } from './buildTree.js';

export function WorkItemList() {
  const {
    backend,
    syncManager,
    navigate,
    selectWorkItem,
    activeType,
    setActiveType,
  } = useAppState();
  const { exit } = useApp();
  const [cursor, setCursor] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [warning, setWarning] = useState('');
  const [settingParent, setSettingParent] = useState(false);
  const [parentInput, setParentInput] = useState('');

  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(
    syncManager?.getStatus() ?? null,
  );

  const {
    capabilities,
    types,
    currentIteration: iteration,
    items: allItems,
    loading,
    refresh: refreshData,
  } = useBackendData(backend);

  useEffect(() => {
    if (!syncManager) return;
    const cb = (status: SyncStatus) => {
      setSyncStatus(status);
      if (status.state === 'idle') {
        refreshData();
      }
    };
    syncManager.onStatusChange(cb);
  }, [syncManager, refreshData]);

  const queueStore = useMemo(() => {
    if (!syncManager) return null;
    return new SyncQueueStore(process.cwd());
  }, [syncManager]);

  const queueWrite = (action: QueueAction, itemId: string) => {
    if (queueStore) {
      void queueStore.append({
        action,
        itemId,
        timestamp: new Date().toISOString(),
      });
      void syncManager?.pushPending().then(() => refreshData());
    }
  };

  const { width: terminalWidth } = useTerminalSize();
  const gitAvailable = useMemo(() => isGitRepo(process.cwd()), []);

  useEffect(() => {
    if (activeType === null && types.length > 0) {
      setActiveType(types[0]!);
    }
  }, [activeType, types, setActiveType]);

  const items = useMemo(
    () => allItems.filter((item) => item.type === activeType),
    [allItems, activeType],
  );
  const treeItems = useMemo(
    () => buildTree(items, allItems, activeType ?? ''),
    [items, allItems, activeType],
  );

  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, treeItems.length - 1)));
  }, [treeItems.length]);

  useInput((input, key) => {
    if (settingParent) {
      if (key.escape) {
        setSettingParent(false);
      }
      return;
    }

    if (confirmDelete) {
      if (input === 'y' || input === 'Y') {
        void (async () => {
          await backend.deleteWorkItem(treeItems[cursor]!.item.id);
          queueWrite('delete', treeItems[cursor]!.item.id);
          setConfirmDelete(false);
          setCursor((c) => Math.max(0, c - 1));
          refreshData();
        })();
      } else {
        setConfirmDelete(false);
      }
      return;
    }

    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
      setWarning('');
    }
    if (key.downArrow) {
      setCursor((c) => Math.min(treeItems.length - 1, c + 1));
      setWarning('');
    }

    if (key.return && treeItems.length > 0) {
      selectWorkItem(treeItems[cursor]!.item.id);
      navigate('form');
    }

    if (input === 'q') exit();
    if (input === 'i' && capabilities.iterations) navigate('iteration-picker');
    if (input === ',') navigate('settings');

    if (input === 'c') {
      selectWorkItem(null);
      navigate('form');
    }

    if (input === 'd' && treeItems.length > 0) {
      setConfirmDelete(true);
    }

    if (input === 'o' && treeItems.length > 0) {
      void (async () => {
        await backend.openItem(treeItems[cursor]!.item.id);
        refreshData();
      })();
    }

    if (input === 'b' && gitAvailable && treeItems.length > 0) {
      const item = treeItems[cursor]!.item;
      const comments = item.comments;
      const config = readConfigSync(process.cwd());
      try {
        const result = beginImplementation(
          item,
          comments,
          { branchMode: config.branchMode ?? 'worktree' },
          process.cwd(),
        );
        setWarning(
          result.resumed
            ? `Resumed work on #${item.id}`
            : `Started work on #${item.id}`,
        );
      } catch (e) {
        setWarning(
          e instanceof Error ? e.message : 'Failed to start implementation',
        );
      }
      refreshData();
    }

    if (input === 's') {
      navigate('status');
    }

    if (
      input === 'p' &&
      capabilities.fields.parent &&
      treeItems.length > 0 &&
      !settingParent
    ) {
      setSettingParent(true);
      const currentParent = treeItems[cursor]!.item.parent;
      setParentInput(currentParent !== null ? String(currentParent) : '');
    }

    if (key.tab && capabilities.customTypes && types.length > 0) {
      const currentIdx = types.indexOf(activeType ?? '');
      const nextType = types[(currentIdx + 1) % types.length]!;
      setActiveType(nextType);
      setCursor(0);
      setWarning('');
    }

    if (input === 'r' && syncManager) {
      void syncManager.sync().then(() => {
        refreshData();
      });
    }
  });

  const typeLabel = activeType
    ? activeType.charAt(0).toUpperCase() + activeType.slice(1) + 's'
    : '';

  const helpParts = [
    'up/down: navigate',
    'enter: edit',
    'o: open',
    'c: create',
    'd: delete',
  ];
  if (capabilities.fields.parent) helpParts.push('p: set parent');
  if (capabilities.customTypes) helpParts.push('tab: type');
  if (capabilities.iterations) helpParts.push('i: iteration');
  if (gitAvailable) helpParts.push('b: branch');
  if (syncManager) helpParts.push('r: sync');
  helpParts.push('s: status', ',: settings', 'q: quit');
  const helpText = helpParts.join('  ');

  const compactHelpParts = [
    '↑↓ Nav',
    'c New',
    '⏎ Edit',
    '⇥ Type',
    's Status',
    'q Quit',
  ];
  const compactHelpText = compactHelpParts.join('  ');

  const isCardMode = terminalWidth < 80;
  const viewport = useScrollViewport({
    totalItems: treeItems.length,
    cursor,
    chromeLines: 6, // title+margin (2) + table header (1) + help bar margin+text (2) + warning (1)
    linesPerItem: isCardMode ? 3 : 1,
  });
  const visibleTreeItems = treeItems.slice(viewport.start, viewport.end);

  if (loading) {
    return (
      <Box>
        <Text dimColor>Loading...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">
          {typeLabel} — {iteration}
        </Text>
        <Text dimColor> ({items.length} items)</Text>
        {syncStatus && (
          <Box>
            <Text dimColor>
              {syncStatus.state === 'syncing'
                ? ' ⟳ Syncing...'
                : syncStatus.state === 'error'
                  ? ` ⚠ Sync failed (${syncStatus.errors.length} errors)`
                  : syncStatus.pendingCount > 0
                    ? ` ↑ ${syncStatus.pendingCount} pending`
                    : ' ✓ Synced'}
            </Text>
          </Box>
        )}
      </Box>

      {terminalWidth >= 80 ? (
        <TableLayout
          treeItems={visibleTreeItems}
          cursor={viewport.visibleCursor}
          capabilities={capabilities}
        />
      ) : (
        <CardLayout
          treeItems={visibleTreeItems}
          cursor={viewport.visibleCursor}
          capabilities={capabilities}
        />
      )}

      {treeItems.length === 0 && (
        <Box marginTop={1}>
          <Text dimColor>No {activeType}s in this iteration.</Text>
        </Box>
      )}

      <Box marginTop={1}>
        {capabilities.fields.parent && settingParent ? (
          <Box>
            <Text color="cyan">Set parent ID (empty to clear): </Text>
            <TextInput
              value={parentInput}
              onChange={setParentInput}
              focus={true}
              onSubmit={(value) => {
                void (async () => {
                  const item = treeItems[cursor]!.item;
                  const newParent = value.trim() === '' ? null : value.trim();
                  try {
                    await backend.updateWorkItem(item.id, {
                      parent: newParent,
                    });
                    queueWrite('update', item.id);
                    setWarning('');
                  } catch (e) {
                    setWarning(
                      e instanceof Error ? e.message : 'Invalid parent',
                    );
                  }
                  setSettingParent(false);
                  setParentInput('');
                  refreshData();
                })();
              }}
            />
          </Box>
        ) : confirmDelete ? (
          <Text color="red">
            Delete item #{treeItems[cursor]?.item.id}? (y/n)
          </Text>
        ) : (
          <Text dimColor>
            {terminalWidth >= 80 ? helpText : compactHelpText}
          </Text>
        )}
      </Box>
      {warning && (
        <Box>
          <Text color="yellow">⚠ {warning}</Text>
        </Box>
      )}
    </Box>
  );
}
