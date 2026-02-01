import { useState, useMemo, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { useAppState } from '../app.js';
import type { WorkItem } from '../types.js';
import { isGitRepo } from '../git.js';
import { beginImplementation } from '../implement.js';
import { readConfig } from '../backends/local/config.js';
import { TableLayout } from './TableLayout.js';
import { CardLayout } from './CardLayout.js';
import { useTerminalWidth } from '../hooks/useTerminalWidth.js';
import { SyncQueueStore } from '../sync/queue.js';
import type { SyncStatus, QueueAction } from '../sync/types.js';

export interface TreeItem {
  item: WorkItem;
  depth: number;
  prefix: string;
}

function buildTree(items: WorkItem[]): TreeItem[] {
  const itemMap = new Map(items.map((i) => [i.id, i]));
  const childrenMap = new Map<string | null, WorkItem[]>();

  for (const item of items) {
    const parentId =
      item.parent !== null && itemMap.has(item.parent) ? item.parent : null;
    if (!childrenMap.has(parentId)) childrenMap.set(parentId, []);
    childrenMap.get(parentId)!.push(item);
  }

  const result: TreeItem[] = [];

  function walk(parentId: string | null, depth: number, parentPrefix: string) {
    const children = childrenMap.get(parentId) ?? [];
    children.forEach((child, idx) => {
      const isLast = idx === children.length - 1;
      let prefix = '';
      if (depth > 0) {
        prefix = parentPrefix + (isLast ? '└─' : '├─');
      }
      result.push({ item: child, depth, prefix });
      const nextParentPrefix =
        depth > 0 ? parentPrefix + (isLast ? '  ' : '│ ') : '';
      walk(child.id, depth + 1, nextParentPrefix);
    });
  }

  walk(null, 0, '');
  return result;
}

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
  const [refresh, setRefresh] = useState(0);
  const [warning, setWarning] = useState('');
  const [settingParent, setSettingParent] = useState(false);
  const [parentInput, setParentInput] = useState('');

  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(
    syncManager?.getStatus() ?? null,
  );

  useEffect(() => {
    if (!syncManager) return;
    const cb = (status: SyncStatus) => setSyncStatus(status);
    syncManager.onStatusChange(cb);
  }, [syncManager]);

  const queueStore = useMemo(() => {
    if (!syncManager) return null;
    return new SyncQueueStore(process.cwd());
  }, [syncManager]);

  const queueWrite = (action: QueueAction, itemId: string) => {
    if (queueStore) {
      queueStore.append({
        action,
        itemId,
        timestamp: new Date().toISOString(),
      });
      void syncManager?.pushPending().then(() => setRefresh((r) => r + 1));
    }
  };

  const capabilities = useMemo(() => backend.getCapabilities(), [backend]);
  const terminalWidth = useTerminalWidth();
  const types = useMemo(() => backend.getWorkItemTypes(), [backend]);
  const gitAvailable = useMemo(() => isGitRepo(process.cwd()), []);

  useEffect(() => {
    if (activeType === null && types.length > 0) {
      setActiveType(types[0]!);
    }
  }, [activeType, types, setActiveType]);

  const iteration = backend.getCurrentIteration();
  const allItems = useMemo(
    () => backend.listWorkItems(iteration),
    [iteration, refresh],
  );
  const items = useMemo(
    () => allItems.filter((item) => item.type === activeType),
    [allItems, activeType],
  );
  const treeItems = useMemo(() => buildTree(items), [items]);

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
        backend.deleteWorkItem(treeItems[cursor]!.item.id);
        queueWrite('delete', treeItems[cursor]!.item.id);
        setConfirmDelete(false);
        setCursor((c) => Math.max(0, c - 1));
        setRefresh((r) => r + 1);
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
      backend.openItem(treeItems[cursor]!.item.id);
      setRefresh((r) => r + 1);
    }

    if (input === 'b' && gitAvailable && treeItems.length > 0) {
      const item = treeItems[cursor]!.item;
      const comments = item.comments;
      const config = readConfig(process.cwd());
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
      setRefresh((r) => r + 1);
    }

    if (input === 's' && capabilities.customTypes && types.length > 0) {
      const currentIdx = types.indexOf(activeType ?? '');
      const nextType = types[(currentIdx + 1) % types.length]!;
      setActiveType(nextType);
      setCursor(0);
      setWarning('');
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
        setRefresh((r) => r + 1);
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
  if (capabilities.customTypes) helpParts.push('s/tab: type');
  if (capabilities.iterations) helpParts.push('i: iteration');
  if (gitAvailable) helpParts.push('b: branch');
  if (syncManager) helpParts.push('r: sync');
  helpParts.push(',: settings', 'q: quit');
  const helpText = helpParts.join('  ');

  const compactHelpParts = ['↑↓ Nav', 'c New', '⏎ Edit', '⇥ Type', 'q Quit'];
  const compactHelpText = compactHelpParts.join('  ');

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
          treeItems={treeItems}
          cursor={cursor}
          capabilities={capabilities}
        />
      ) : (
        <CardLayout
          treeItems={treeItems}
          cursor={cursor}
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
                const item = treeItems[cursor]!.item;
                const newParent = value.trim() === '' ? null : value.trim();
                try {
                  backend.updateWorkItem(item.id, { parent: newParent });
                  queueWrite('update', item.id);
                  setWarning('');
                } catch (e) {
                  setWarning(e instanceof Error ? e.message : 'Invalid parent');
                }
                setSettingParent(false);
                setParentInput('');
                setRefresh((r) => r + 1);
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
