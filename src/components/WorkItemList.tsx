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
import { BulkMenu, type BulkAction } from './BulkMenu.js';
import { CommandPalette } from './CommandPalette.js';
import {
  getVisibleCommands,
  type Command,
  type CommandContext,
} from '../commands.js';
import { PriorityPicker } from './PriorityPicker.js';
import { TemplatePicker } from './TemplatePicker.js';
import { TypePicker } from './TypePicker.js';
import { StatusPicker } from './StatusPicker.js';
import type { WorkItem, Template } from '../types.js';
export type { TreeItem } from './buildTree.js';

export function getTargetIds(
  markedIds: Set<string>,
  cursorItem: { id: string } | undefined,
): string[] {
  if (markedIds.size > 0) {
    return [...markedIds];
  }
  return cursorItem ? [cursorItem.id] : [];
}

export function WorkItemList() {
  const {
    backend,
    syncManager,
    navigate,
    navigateToHelp,
    selectWorkItem,
    activeType,
    setActiveType,
    setActiveTemplate,
    setFormMode,
    updateInfo,
    defaultType,
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
  const [deleteTargetIds, setDeleteTargetIds] = useState<string[]>([]);
  const [parentTargetIds, setParentTargetIds] = useState<string[]>([]);
  const [showBulkMenu, setShowBulkMenu] = useState(false);
  const [showStatusPicker, setShowStatusPicker] = useState(false);
  const [showTypePicker, setShowTypePicker] = useState(false);
  const [showPriorityPicker, setShowPriorityPicker] = useState(false);
  const [settingAssignee, setSettingAssignee] = useState(false);
  const [assigneeInput, setAssigneeInput] = useState('');
  const [settingLabels, setSettingLabels] = useState(false);
  const [labelsInput, setLabelsInput] = useState('');
  const [bulkTargetIds, setBulkTargetIds] = useState<string[]>([]);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);

  // Marked count for header display
  const markedCount = markedIds.size;

  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(
    syncManager?.getStatus() ?? null,
  );

  const {
    capabilities,
    types,
    statuses,
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

  useEffect(() => {
    if (capabilities.templates) {
      void backend.listTemplates().then(setTemplates);
    }
  }, [backend, capabilities.templates]);

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
      setActiveType(
        defaultType && types.includes(defaultType) ? defaultType : types[0]!,
      );
    }
  }, [activeType, types, setActiveType, defaultType]);

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

  const isCardMode = terminalWidth < 80;
  const viewport = useScrollViewport({
    totalItems: treeItems.length,
    cursor,
    chromeLines: 6, // title+margin (2) + table header (1) + help bar margin+text (2) + warning (1)
    linesPerItem: isCardMode ? 3 : 1,
  });

  useInput((input, key) => {
    if (settingParent) {
      if (key.escape) {
        setSettingParent(false);
      }
      return;
    }

    if (showBulkMenu) return;

    if (settingAssignee) {
      if (key.escape) {
        setSettingAssignee(false);
        setBulkTargetIds([]);
      }
      return;
    }

    if (settingLabels) {
      if (key.escape) {
        setSettingLabels(false);
        setBulkTargetIds([]);
      }
      return;
    }

    if (isSearching) return;

    if (showCommandPalette) return;

    if (showTemplatePicker) return;

    if (confirmDelete) {
      if (input === 'y' || input === 'Y') {
        void (async () => {
          for (const id of deleteTargetIds) {
            await backend.cachedDeleteWorkItem(id);
            await queueWrite('delete', id);
          }
          setConfirmDelete(false);
          setDeleteTargetIds([]);
          setMarkedIds((prev) => {
            const next = new Set(prev);
            for (const id of deleteTargetIds) {
              next.delete(id);
            }
            return next;
          });
          setCursor((c) => Math.max(0, c - 1));
          refreshData();
        })();
      } else {
        setConfirmDelete(false);
        setDeleteTargetIds([]);
      }
      return;
    }

    if (input === '/') {
      setIsSearching(true);
      return;
    }

    if (input === ':') {
      setShowCommandPalette(true);
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
    if (key.pageUp) {
      setCursor((c) => Math.max(0, c - viewport.maxVisible));
      setWarning('');
    }
    if (key.pageDown) {
      setCursor((c) => Math.min(treeItems.length - 1, c + viewport.maxVisible));
      setWarning('');
    }
    if (key.home) {
      setCursor(0);
      setWarning('');
    }
    if (key.end) {
      setCursor(treeItems.length - 1);
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
      setFormMode('item');
      selectWorkItem(treeItems[cursor]!.item.id);
      navigate('form');
    }

    if (input === 'q') exit();
    if (input === 'i' && capabilities.iterations) navigate('iteration-picker');
    if (input === ',') navigate('settings');

    if (input === 'c') {
      if (capabilities.templates && templates.length > 0) {
        setShowTemplatePicker(true);
      } else {
        setFormMode('item');
        setActiveTemplate(null);
        selectWorkItem(null);
        navigate('form');
      }
    }

    if (input === 'd' && treeItems.length > 0) {
      const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
      if (targetIds.length > 0) {
        setDeleteTargetIds(targetIds);
        setConfirmDelete(true);
      }
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
      const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
      if (targetIds.length > 0) {
        setParentTargetIds(targetIds);
        setSettingParent(true);
        // For single item, prefill current parent
        if (targetIds.length === 1) {
          const item = treeItems.find((t) => t.item.id === targetIds[0]);
          setParentInput(item?.item.parent ?? '');
        } else {
          setParentInput('');
        }
      }
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

    if (input === 'M') {
      setMarkedIds(new Set());
    }

    if (input === 'B' && treeItems.length > 0) {
      setShowBulkMenu(true);
    }

    if (input === 'P' && capabilities.fields.priority && treeItems.length > 0) {
      const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
      if (targetIds.length > 0) {
        setBulkTargetIds(targetIds);
        setShowPriorityPicker(true);
      }
    }

    if (input === 'a' && capabilities.fields.assignee && treeItems.length > 0) {
      const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
      if (targetIds.length > 0) {
        setBulkTargetIds(targetIds);
        setSettingAssignee(true);
        setAssigneeInput('');
      }
    }

    if (input === 'l' && capabilities.fields.labels && treeItems.length > 0) {
      const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
      if (targetIds.length > 0) {
        setBulkTargetIds(targetIds);
        setSettingLabels(true);
        setLabelsInput('');
      }
    }

    if (input === 't' && capabilities.customTypes && treeItems.length > 0) {
      const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
      if (targetIds.length > 0) {
        setBulkTargetIds(targetIds);
        setShowTypePicker(true);
      }
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

  const commandContext: CommandContext = {
    screen: 'list',
    markedCount: markedIds.size,
    hasSelectedItem: treeItems.length > 0 && treeItems[cursor] !== undefined,
    capabilities,
    types,
    activeType,
    hasSyncManager: syncManager !== null,
    gitAvailable,
  };

  const paletteCommands = useMemo(
    () => getVisibleCommands(commandContext),
    [
      commandContext.markedCount,
      commandContext.hasSelectedItem,
      capabilities,
      types,
      activeType,
      syncManager,
      gitAvailable,
    ],
  );

  const handleCommandSelect = (command: Command) => {
    setShowCommandPalette(false);
    switch (command.id) {
      case 'create':
        selectWorkItem(null);
        navigate('form');
        break;
      case 'edit':
        if (treeItems[cursor]) {
          selectWorkItem(treeItems[cursor].item.id);
          navigate('form');
        }
        break;
      case 'delete':
        if (treeItems.length > 0) {
          const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
          if (targetIds.length > 0) {
            setDeleteTargetIds(targetIds);
            setConfirmDelete(true);
          }
        }
        break;
      case 'open':
        if (treeItems[cursor]) {
          void (async () => {
            await backend.openItem(treeItems[cursor]!.item.id);
            refreshData();
          })();
        }
        break;
      case 'branch':
        if (treeItems[cursor]) {
          const item = treeItems[cursor].item;
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
        break;
      case 'sync':
        if (syncManager) {
          void syncManager.sync().then(() => refreshData());
        }
        break;
      case 'iterations':
        navigate('iteration-picker');
        break;
      case 'settings':
        navigate('settings');
        break;
      case 'status':
        navigate('status');
        break;
      case 'help':
        navigateToHelp();
        break;
      case 'mark':
        if (treeItems[cursor]) {
          const itemId = treeItems[cursor].item.id;
          setMarkedIds((prev) => {
            const next = new Set(prev);
            if (next.has(itemId)) next.delete(itemId);
            else next.add(itemId);
            return next;
          });
        }
        break;
      case 'clear-marks':
        setMarkedIds(new Set());
        break;
      case 'set-priority':
        {
          const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
          if (targetIds.length > 0) {
            setBulkTargetIds(targetIds);
            setShowPriorityPicker(true);
          }
        }
        break;
      case 'set-assignee':
        {
          const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
          if (targetIds.length > 0) {
            setBulkTargetIds(targetIds);
            setSettingAssignee(true);
            setAssigneeInput('');
          }
        }
        break;
      case 'set-labels':
        {
          const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
          if (targetIds.length > 0) {
            setBulkTargetIds(targetIds);
            setSettingLabels(true);
            setLabelsInput('');
          }
        }
        break;
      case 'set-type':
        {
          const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
          if (targetIds.length > 0) {
            setBulkTargetIds(targetIds);
            setShowTypePicker(true);
          }
        }
        break;
      case 'bulk-menu':
        setShowBulkMenu(true);
        break;
      case 'quit':
        exit();
        break;
      default:
        // Handle dynamic switch-type commands
        if (command.id.startsWith('switch-')) {
          const type = command.id.replace('switch-', '');
          setActiveType(type);
          setCursor(0);
          setWarning('');
        }
        break;
    }
  };

  const handleBulkAction = (action: BulkAction) => {
    const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
    if (targetIds.length === 0) return;
    setBulkTargetIds(targetIds);

    switch (action) {
      case 'status':
        setShowStatusPicker(true);
        break;
      case 'iteration':
        navigate('iteration-picker');
        break;
      case 'parent':
        setParentTargetIds(targetIds);
        setSettingParent(true);
        setParentInput('');
        break;
      case 'type':
        setShowTypePicker(true);
        break;
      case 'priority':
        setShowPriorityPicker(true);
        break;
      case 'assignee':
        setSettingAssignee(true);
        setAssigneeInput('');
        break;
      case 'labels':
        setSettingLabels(true);
        setLabelsInput('');
        break;
      case 'delete':
        setDeleteTargetIds(targetIds);
        setConfirmDelete(true);
        break;
    }
  };

  const typeLabel = activeType
    ? activeType.charAt(0).toUpperCase() + activeType.slice(1) + 's'
    : '';

  const helpText =
    '↑↓ navigate  ←→ expand/collapse  enter edit  c create  , settings  ? help';

  const visibleTreeItems = treeItems.slice(viewport.start, viewport.end);

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
          {showBulkMenu && (
            <BulkMenu
              itemCount={markedIds.size > 0 ? markedIds.size : 1}
              capabilities={capabilities}
              onSelect={(action) => {
                setShowBulkMenu(false);
                handleBulkAction(action);
              }}
              onCancel={() => setShowBulkMenu(false)}
            />
          )}
          {showCommandPalette && (
            <CommandPalette
              commands={paletteCommands}
              onSelect={handleCommandSelect}
              onCancel={() => setShowCommandPalette(false)}
            />
          )}
          {showStatusPicker && (
            <StatusPicker
              statuses={statuses}
              onSelect={(status) => {
                void (async () => {
                  setShowStatusPicker(false);
                  for (const id of bulkTargetIds) {
                    await backend.cachedUpdateWorkItem(id, { status });
                    await queueWrite('update', id);
                  }
                  setBulkTargetIds([]);
                  refreshData();
                })();
              }}
              onCancel={() => {
                setShowStatusPicker(false);
                setBulkTargetIds([]);
              }}
            />
          )}
          {showTypePicker && (
            <TypePicker
              types={types}
              onSelect={(type) => {
                void (async () => {
                  setShowTypePicker(false);
                  for (const id of bulkTargetIds) {
                    await backend.cachedUpdateWorkItem(id, { type });
                    await queueWrite('update', id);
                  }
                  setBulkTargetIds([]);
                  refreshData();
                })();
              }}
              onCancel={() => {
                setShowTypePicker(false);
                setBulkTargetIds([]);
              }}
            />
          )}
          {showPriorityPicker && (
            <PriorityPicker
              onSelect={(priority) => {
                void (async () => {
                  setShowPriorityPicker(false);
                  for (const id of bulkTargetIds) {
                    await backend.cachedUpdateWorkItem(id, { priority });
                    await queueWrite('update', id);
                  }
                  setBulkTargetIds([]);
                  refreshData();
                })();
              }}
              onCancel={() => {
                setShowPriorityPicker(false);
                setBulkTargetIds([]);
              }}
            />
          )}
          {showTemplatePicker && (
            <TemplatePicker
              templates={templates}
              onSelect={(template) => {
                setShowTemplatePicker(false);
                setFormMode('item');
                setActiveTemplate(template);
                selectWorkItem(null);
                navigate('form');
              }}
              onCancel={() => {
                setShowTemplatePicker(false);
              }}
            />
          )}
          <Box marginBottom={1}>
            <Text wrap="truncate">
              <Text bold color="cyan">
                {typeLabel} — {iteration}
              </Text>
              <Text dimColor>{` (${items.length} items)`}</Text>
            </Text>
            {loading && (
              <Box marginLeft={1}>
                <Text color="yellow">
                  <Spinner type="dots" />
                </Text>
              </Box>
            )}
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
            {markedCount > 0 && (
              <Text color="magenta">{` ● ${markedCount} marked`}</Text>
            )}
          </Box>

          {terminalWidth >= 80 ? (
            <TableLayout
              treeItems={visibleTreeItems}
              cursor={viewport.visibleCursor}
              capabilities={capabilities}
              collapsedIds={collapsedIds}
              markedIds={markedIds}
            />
          ) : (
            <CardLayout
              treeItems={visibleTreeItems}
              cursor={viewport.visibleCursor}
              capabilities={capabilities}
              collapsedIds={collapsedIds}
              markedIds={markedIds}
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
                <Text color="cyan">
                  Set parent for {parentTargetIds.length} item
                  {parentTargetIds.length > 1 ? 's' : ''} (empty to clear):{' '}
                </Text>
                <TextInput
                  value={parentInput}
                  onChange={setParentInput}
                  focus={true}
                  onSubmit={(value) => {
                    void (async () => {
                      const newParent =
                        value.trim() === '' ? null : value.trim();
                      try {
                        for (const id of parentTargetIds) {
                          await backend.cachedUpdateWorkItem(id, {
                            parent: newParent,
                          });
                          await queueWrite('update', id);
                        }
                        setWarning('');
                      } catch (e) {
                        setWarning(
                          e instanceof Error ? e.message : 'Invalid parent',
                        );
                      }
                      setSettingParent(false);
                      setParentInput('');
                      setParentTargetIds([]);
                      refreshData();
                    })();
                  }}
                />
              </Box>
            ) : settingAssignee ? (
              <Box>
                <Text color="cyan">
                  Set assignee for {bulkTargetIds.length} item
                  {bulkTargetIds.length > 1 ? 's' : ''}:{' '}
                </Text>
                <TextInput
                  value={assigneeInput}
                  onChange={setAssigneeInput}
                  focus={true}
                  onSubmit={(value) => {
                    void (async () => {
                      const assignee = value.trim();
                      for (const id of bulkTargetIds) {
                        await backend.cachedUpdateWorkItem(id, { assignee });
                        await queueWrite('update', id);
                      }
                      setSettingAssignee(false);
                      setAssigneeInput('');
                      setBulkTargetIds([]);
                      refreshData();
                    })();
                  }}
                />
              </Box>
            ) : settingLabels ? (
              <Box>
                <Text color="cyan">
                  Set labels for {bulkTargetIds.length} item
                  {bulkTargetIds.length > 1 ? 's' : ''} (comma-separated):{' '}
                </Text>
                <TextInput
                  value={labelsInput}
                  onChange={setLabelsInput}
                  focus={true}
                  onSubmit={(value) => {
                    void (async () => {
                      const labels = value
                        .split(',')
                        .map((l) => l.trim())
                        .filter(Boolean);
                      for (const id of bulkTargetIds) {
                        await backend.cachedUpdateWorkItem(id, { labels });
                        await queueWrite('update', id);
                      }
                      setSettingLabels(false);
                      setLabelsInput('');
                      setBulkTargetIds([]);
                      refreshData();
                    })();
                  }}
                />
              </Box>
            ) : confirmDelete ? (
              <Text color="red">
                Delete {deleteTargetIds.length} item
                {deleteTargetIds.length > 1 ? 's' : ''}? (y/n)
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
          {updateInfo?.updateAvailable &&
            !confirmDelete &&
            !settingParent &&
            !settingAssignee &&
            !settingLabels && (
              <Box>
                <Text color="yellow">
                  Update available: {updateInfo.current} → {updateInfo.latest}{' '}
                  Press , to update in Settings
                </Text>
              </Box>
            )}
        </>
      )}
    </Box>
  );
}
