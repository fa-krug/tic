import { useState, useMemo, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import Spinner from 'ink-spinner';
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
import { buildTree, type TreeItem } from './buildTree.js';
import { SearchOverlay } from './SearchOverlay.js';
import type { WorkItem } from '../types.js';
export type { TreeItem } from './buildTree.js';

export function WorkItemList() {
  const {
    backend,
    syncManager,
    navigate,
    navigateToHelp,
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
  const [isSearching, setIsSearching] = useState(false);
  const [allSearchItems, setAllSearchItems] = useState<WorkItem[]>([]);
  // Marked items state for bulk operations
  const [markedIds, setMarkedIds] = useState<Set<string>>(() => new Set());

  // Marked count for header display (used in subsequent tasks)
  const markedCount = markedIds.size;
  void markedCount; // Will be displayed in header in subsequent task

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

  const queueWrite = async (action: QueueAction, itemId: string) => {
    if (queueStore) {
      await queueStore.append({
        action,
        itemId,
        timestamp: new Date().toISOString(),
      });
      await syncManager?.pushPending();
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
  const fullTree = useMemo(
    () =>
      capabilities.relationships
        ? buildTree(items, allItems, activeType ?? '')
        : buildTree(items, items, activeType ?? ''),
    [items, allItems, activeType, capabilities.relationships],
  );

  // Collapse state: set of item IDs that are collapsed (collapsed by default)
  // Track explicitly expanded items (inverse of collapsed).
  // All parents are collapsed by default; expanding removes from this set.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set<string>(),
  );

  // Derive collapsedIds: all parents minus explicitly expanded ones
  const collapsedIds = useMemo(() => {
    const parentIds = new Set(
      fullTree.filter((t) => t.hasChildren).map((t) => t.item.id),
    );
    const collapsed = new Set<string>();
    for (const id of parentIds) {
      if (!expandedIds.has(id)) {
        collapsed.add(id);
      }
    }
    return collapsed;
  }, [fullTree, expandedIds]);

  // Filter tree to hide children of collapsed items
  const treeItems = useMemo(() => {
    const result: TreeItem[] = [];
    let skipDepth: number | null = null;
    for (const t of fullTree) {
      if (skipDepth !== null && t.depth > skipDepth) continue;
      skipDepth = null;
      result.push(t);
      if (collapsedIds.has(t.item.id)) {
        skipDepth = t.depth;
      }
    }
    return result;
  }, [fullTree, collapsedIds]);

  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, treeItems.length - 1)));
  }, [treeItems.length]);

  useEffect(() => {
    if (!isSearching) return;
    let cancelled = false;
    void backend.listWorkItems().then((items) => {
      if (!cancelled) setAllSearchItems(items);
    });
    return () => {
      cancelled = true;
    };
  }, [isSearching, backend]);

  useInput((input, key) => {
    if (settingParent) {
      if (key.escape) {
        setSettingParent(false);
      }
      return;
    }

    if (isSearching) return;

    if (confirmDelete) {
      if (input === 'y' || input === 'Y') {
        void (async () => {
          await backend.cachedDeleteWorkItem(treeItems[cursor]!.item.id);
          await queueWrite('delete', treeItems[cursor]!.item.id);
          setConfirmDelete(false);
          setCursor((c) => Math.max(0, c - 1));
          refreshData();
        })();
      } else {
        setConfirmDelete(false);
      }
      return;
    }

    if (input === '/') {
      setIsSearching(true);
      return;
    }

    if (input === '?') {
      navigateToHelp();
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

    if (key.rightArrow && treeItems.length > 0) {
      const current = treeItems[cursor];
      if (current && current.hasChildren && collapsedIds.has(current.item.id)) {
        setExpandedIds((prev) => new Set(prev).add(current.item.id));
      }
    }

    if (key.leftArrow && treeItems.length > 0) {
      const current = treeItems[cursor];
      if (current) {
        if (current.hasChildren && !collapsedIds.has(current.item.id)) {
          setExpandedIds((prev) => {
            const next = new Set(prev);
            next.delete(current.item.id);
            return next;
          });
        } else if (current.depth > 0 && current.item.parent) {
          const parentIdx = treeItems.findIndex(
            (t) => t.item.id === current.item.parent,
          );
          if (parentIdx >= 0) setCursor(parentIdx);
        }
      }
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

    if (input === 'm' && treeItems.length > 0) {
      const itemId = treeItems[cursor]!.item.id;
      setMarkedIds((prev) => {
        const next = new Set(prev);
        if (next.has(itemId)) {
          next.delete(itemId);
        } else {
          next.add(itemId);
        }
        return next;
      });
    }
  });

  const handleSearchSelect = (item: WorkItem) => {
    setIsSearching(false);
    selectWorkItem(item.id);
    navigate('form');
  };

  const handleSearchCancel = () => {
    setIsSearching(false);
  };

  const typeLabel = activeType
    ? activeType.charAt(0).toUpperCase() + activeType.slice(1) + 's'
    : '';

  const helpText = '↑↓ navigate  enter edit  c create  / search  ? help';

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
      {isSearching && (
        <SearchOverlay
          items={allSearchItems}
          currentIteration={iteration}
          onSelect={handleSearchSelect}
          onCancel={handleSearchCancel}
        />
      )}
      {!isSearching && (
        <>
          <Box marginBottom={1}>
            <Text wrap="truncate">
              <Text bold color="cyan">
                {typeLabel} — {iteration}
              </Text>
              <Text dimColor>{` (${items.length} items)`}</Text>
            </Text>
            {syncStatus && syncStatus.state === 'syncing' ? (
              <Box marginLeft={1}>
                <Text color="yellow">
                  <Spinner type="dots" />
                </Text>
                <Text dimColor> Syncing...</Text>
              </Box>
            ) : syncStatus && syncStatus.state === 'error' ? (
              <Text dimColor>
                {` ⚠ Sync failed (${syncStatus.errors.length} errors)`}
              </Text>
            ) : syncStatus && syncStatus.pendingCount > 0 ? (
              <Text dimColor>{` ↑ ${syncStatus.pendingCount} pending`}</Text>
            ) : syncStatus ? (
              <Text dimColor> ✓ Synced</Text>
            ) : null}
          </Box>

          {terminalWidth >= 80 ? (
            <TableLayout
              treeItems={visibleTreeItems}
              cursor={viewport.visibleCursor}
              capabilities={capabilities}
              collapsedIds={collapsedIds}
            />
          ) : (
            <CardLayout
              treeItems={visibleTreeItems}
              cursor={viewport.visibleCursor}
              capabilities={capabilities}
              collapsedIds={collapsedIds}
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
                      const newParent =
                        value.trim() === '' ? null : value.trim();
                      try {
                        await backend.cachedUpdateWorkItem(item.id, {
                          parent: newParent,
                        });
                        await queueWrite('update', item.id);
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
              <Text dimColor>{helpText}</Text>
            )}
          </Box>
          {warning && (
            <Box>
              <Text color="yellow">⚠ {warning}</Text>
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
