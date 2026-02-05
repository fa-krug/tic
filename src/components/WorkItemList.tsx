import { useState, useMemo, useEffect, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import Spinner from 'ink-spinner';

import { useAppState } from '../app.js';
import { isGitRepo } from '../git.js';
import { beginImplementation } from '../implement.js';
import { useConfigStore } from '../stores/configStore.js';
import { uiStore, useUIStore } from '../stores/uiStore.js';
import { TableLayout } from './TableLayout.js';
import { CardLayout } from './CardLayout.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { useScrollViewport } from '../hooks/useScrollViewport.js';
import {
  useBackendDataStore,
  backendDataStore,
} from '../stores/backendDataStore.js';
import { SyncQueueStore } from '../sync/queue.js';
import type { QueueAction } from '../sync/types.js';
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
import { AutocompleteInput } from './AutocompleteInput.js';
import { MultiAutocompleteInput } from './MultiAutocompleteInput.js';
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
  } = useAppState();
  const defaultType = useConfigStore((s) => s.config.defaultType ?? null);
  const branchMode = useConfigStore((s) => s.config.branchMode ?? 'worktree');
  const { exit } = useApp();
  const [cursor, setCursor] = useState(0);
  const [parentInput, setParentInput] = useState('');
  const [allSearchItems, setAllSearchItems] = useState<WorkItem[]>([]);
  // Marked items state for bulk operations
  const [markedIds, setMarkedIds] = useState<Set<string>>(() => new Set());
  const [assigneeInput, setAssigneeInput] = useState('');
  const [labelsInput, setLabelsInput] = useState('');
  const [templates, setTemplates] = useState<Template[]>([]);

  // UI overlay state from store
  const activeOverlay = useUIStore((s) => s.activeOverlay);
  const warning = useUIStore((s) => s.warning);
  const { openOverlay, closeOverlay, setWarning, clearWarning } =
    uiStore.getState();

  // Marked count for header display
  const markedCount = markedIds.size;

  const syncStatus = useBackendDataStore((s) => s.syncStatus);

  const capabilities = useBackendDataStore((s) => s.capabilities);
  const types = useBackendDataStore((s) => s.types);
  const statuses = useBackendDataStore((s) => s.statuses);
  const assignees = useBackendDataStore((s) => s.assignees);
  const labelSuggestions = useBackendDataStore((s) => s.labels);
  const iteration = useBackendDataStore((s) => s.currentIteration);
  const allItems = useBackendDataStore((s) => s.items);
  const loading = useBackendDataStore((s) => s.loading);
  const refreshData = useCallback(() => {
    void backendDataStore.getState().refresh();
  }, []);

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

  const parentSuggestions = useMemo(
    () => allItems.map((item) => `${item.id} - ${item.title}`),
    [allItems],
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
    if (activeOverlay?.type !== 'search') return;
    let cancelled = false;
    void backend.listWorkItems().then((items) => {
      if (!cancelled) setAllSearchItems(items);
    });
    return () => {
      cancelled = true;
    };
  }, [activeOverlay?.type, backend]);

  const isCardMode = terminalWidth < 80;
  const viewport = useScrollViewport({
    totalItems: treeItems.length,
    cursor,
    chromeLines: 6, // title+margin (2) + table header (1) + help bar margin+text (2) + warning (1)
    linesPerItem: isCardMode ? 3 : 1,
  });

  // Block 1: Overlay escape handlers for inline inputs
  useInput(
    (_input, key) => {
      if (key.escape) {
        closeOverlay();
      }
    },
    {
      isActive:
        activeOverlay?.type === 'parent-input' ||
        activeOverlay?.type === 'assignee-input' ||
        activeOverlay?.type === 'labels-input',
    },
  );

  // Block 2: Delete confirmation handler
  useInput(
    (input) => {
      if (activeOverlay?.type !== 'delete-confirm') return;
      if (input === 'y' || input === 'Y') {
        const targetIds = activeOverlay.targetIds;
        void (async () => {
          for (const id of targetIds) {
            await backend.cachedDeleteWorkItem(id);
            await queueWrite('delete', id);
          }
          closeOverlay();
          setMarkedIds((prev) => {
            const next = new Set(prev);
            for (const id of targetIds) {
              next.delete(id);
            }
            return next;
          });
          setCursor((c) => Math.max(0, c - 1));
          refreshData();
        })();
      } else {
        closeOverlay();
      }
    },
    { isActive: activeOverlay?.type === 'delete-confirm' },
  );

  // Block 3: Main input handler — only active when no overlay is open
  useInput(
    (input, key) => {
      if (input === '/') {
        openOverlay({ type: 'search' });
        return;
      }

      if (input === ':') {
        openOverlay({ type: 'command-palette' });
        return;
      }

      if (input === '?') {
        navigateToHelp();
        return;
      }

      if (key.upArrow) {
        setCursor((c) => Math.max(0, c - 1));
        clearWarning();
      }
      if (key.downArrow) {
        setCursor((c) => Math.min(treeItems.length - 1, c + 1));
        clearWarning();
      }
      if (key.pageUp) {
        setCursor((c) => Math.max(0, c - viewport.maxVisible));
        clearWarning();
      }
      if (key.pageDown) {
        setCursor((c) =>
          Math.min(treeItems.length - 1, c + viewport.maxVisible),
        );
        clearWarning();
      }
      if (key.home) {
        setCursor(0);
        clearWarning();
      }
      if (key.end) {
        setCursor(treeItems.length - 1);
        clearWarning();
      }

      if (key.rightArrow && treeItems.length > 0) {
        const current = treeItems[cursor];
        if (
          current &&
          current.hasChildren &&
          collapsedIds.has(current.item.id)
        ) {
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
      if (input === 'i' && capabilities.iterations)
        navigate('iteration-picker');
      if (input === ',') navigate('settings');

      if (input === 'c') {
        if (capabilities.templates && templates.length > 0) {
          openOverlay({ type: 'template-picker' });
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
          openOverlay({ type: 'delete-confirm', targetIds });
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
        try {
          const result = beginImplementation(
            item,
            comments,
            { branchMode },
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

      if (input === 'p' && capabilities.fields.parent && treeItems.length > 0) {
        const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
        if (targetIds.length > 0) {
          openOverlay({ type: 'parent-input', targetIds });
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
        clearWarning();
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
        openOverlay({ type: 'bulk-menu' });
      }

      if (
        input === 'P' &&
        capabilities.fields.priority &&
        treeItems.length > 0
      ) {
        const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
        if (targetIds.length > 0) {
          openOverlay({ type: 'priority-picker', targetIds });
        }
      }

      if (
        input === 'a' &&
        capabilities.fields.assignee &&
        treeItems.length > 0
      ) {
        const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
        if (targetIds.length > 0) {
          openOverlay({ type: 'assignee-input', targetIds });
          setAssigneeInput('');
        }
      }

      if (input === 'l' && capabilities.fields.labels && treeItems.length > 0) {
        const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
        if (targetIds.length > 0) {
          openOverlay({ type: 'labels-input', targetIds });
          setLabelsInput('');
        }
      }

      if (input === 't' && capabilities.customTypes && treeItems.length > 0) {
        const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
        if (targetIds.length > 0) {
          openOverlay({ type: 'type-picker', targetIds });
        }
      }
    },
    { isActive: activeOverlay === null },
  );

  const handleSearchSelect = (item: WorkItem) => {
    closeOverlay();
    selectWorkItem(item.id);
    navigate('form');
  };

  const handleSearchCancel = () => {
    closeOverlay();
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
    closeOverlay();
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
            openOverlay({ type: 'delete-confirm', targetIds });
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
          try {
            const result = beginImplementation(
              item,
              comments,
              { branchMode },
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
            openOverlay({ type: 'priority-picker', targetIds });
          }
        }
        break;
      case 'set-assignee':
        {
          const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
          if (targetIds.length > 0) {
            openOverlay({ type: 'assignee-input', targetIds });
            setAssigneeInput('');
          }
        }
        break;
      case 'set-labels':
        {
          const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
          if (targetIds.length > 0) {
            openOverlay({ type: 'labels-input', targetIds });
            setLabelsInput('');
          }
        }
        break;
      case 'set-type':
        {
          const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
          if (targetIds.length > 0) {
            openOverlay({ type: 'type-picker', targetIds });
          }
        }
        break;
      case 'bulk-menu':
        openOverlay({ type: 'bulk-menu' });
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
          clearWarning();
        }
        break;
    }
  };

  const handleBulkAction = (action: BulkAction) => {
    const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
    if (targetIds.length === 0) return;

    switch (action) {
      case 'status':
        openOverlay({ type: 'status-picker', targetIds });
        break;
      case 'iteration':
        navigate('iteration-picker');
        break;
      case 'parent':
        openOverlay({ type: 'parent-input', targetIds });
        setParentInput('');
        break;
      case 'type':
        openOverlay({ type: 'type-picker', targetIds });
        break;
      case 'priority':
        openOverlay({ type: 'priority-picker', targetIds });
        break;
      case 'assignee':
        openOverlay({ type: 'assignee-input', targetIds });
        setAssigneeInput('');
        break;
      case 'labels':
        openOverlay({ type: 'labels-input', targetIds });
        setLabelsInput('');
        break;
      case 'delete':
        openOverlay({ type: 'delete-confirm', targetIds });
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
      {activeOverlay?.type === 'search' && (
        <SearchOverlay
          items={allSearchItems}
          currentIteration={iteration}
          onSelect={handleSearchSelect}
          onCancel={handleSearchCancel}
        />
      )}
      {activeOverlay?.type !== 'search' && (
        <>
          {activeOverlay?.type === 'bulk-menu' && (
            <BulkMenu
              itemCount={markedIds.size > 0 ? markedIds.size : 1}
              capabilities={capabilities}
              onSelect={(action) => {
                closeOverlay();
                handleBulkAction(action);
              }}
              onCancel={() => closeOverlay()}
            />
          )}
          {activeOverlay?.type === 'command-palette' && (
            <CommandPalette
              commands={paletteCommands}
              onSelect={handleCommandSelect}
              onCancel={() => closeOverlay()}
            />
          )}
          {activeOverlay?.type === 'status-picker' && (
            <StatusPicker
              statuses={statuses}
              onSelect={(status) => {
                const targetIds = (activeOverlay as { targetIds: string[] })
                  .targetIds;
                closeOverlay();
                void (async () => {
                  for (const id of targetIds) {
                    await backend.cachedUpdateWorkItem(id, { status });
                    await queueWrite('update', id);
                  }
                  refreshData();
                })();
              }}
              onCancel={() => closeOverlay()}
            />
          )}
          {activeOverlay?.type === 'type-picker' && (
            <TypePicker
              types={types}
              onSelect={(type) => {
                const targetIds = (activeOverlay as { targetIds: string[] })
                  .targetIds;
                closeOverlay();
                void (async () => {
                  for (const id of targetIds) {
                    await backend.cachedUpdateWorkItem(id, { type });
                    await queueWrite('update', id);
                  }
                  refreshData();
                })();
              }}
              onCancel={() => closeOverlay()}
            />
          )}
          {activeOverlay?.type === 'priority-picker' && (
            <PriorityPicker
              onSelect={(priority) => {
                const targetIds = (activeOverlay as { targetIds: string[] })
                  .targetIds;
                closeOverlay();
                void (async () => {
                  for (const id of targetIds) {
                    await backend.cachedUpdateWorkItem(id, { priority });
                    await queueWrite('update', id);
                  }
                  refreshData();
                })();
              }}
              onCancel={() => closeOverlay()}
            />
          )}
          {activeOverlay?.type === 'template-picker' && (
            <TemplatePicker
              templates={templates}
              onSelect={(template) => {
                closeOverlay();
                setFormMode('item');
                setActiveTemplate(template);
                selectWorkItem(null);
                navigate('form');
              }}
              onCancel={() => closeOverlay()}
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
            {activeOverlay?.type === 'parent-input' ? (
              <Box flexDirection="column">
                <Text color="cyan">
                  Set parent for {activeOverlay.targetIds.length} item
                  {activeOverlay.targetIds.length > 1 ? 's' : ''} (empty to
                  clear):
                </Text>
                <AutocompleteInput
                  value={parentInput}
                  onChange={setParentInput}
                  focus={true}
                  suggestions={parentSuggestions}
                  onSubmit={() => {
                    const targetIds = (activeOverlay as { targetIds: string[] })
                      .targetIds;
                    void (async () => {
                      const raw = parentInput.trim();
                      const newParent =
                        raw === ''
                          ? null
                          : raw.includes(' - ')
                            ? raw.split(' - ')[0]!.trim()
                            : raw;
                      try {
                        for (const id of targetIds) {
                          await backend.cachedUpdateWorkItem(id, {
                            parent: newParent,
                          });
                          await queueWrite('update', id);
                        }
                        clearWarning();
                      } catch (e) {
                        setWarning(
                          e instanceof Error ? e.message : 'Invalid parent',
                        );
                      }
                      closeOverlay();
                      setParentInput('');
                      refreshData();
                    })();
                  }}
                />
              </Box>
            ) : activeOverlay?.type === 'assignee-input' ? (
              <Box flexDirection="column">
                <Text color="cyan">
                  Set assignee for {activeOverlay.targetIds.length} item
                  {activeOverlay.targetIds.length > 1 ? 's' : ''}:
                </Text>
                <AutocompleteInput
                  value={assigneeInput}
                  onChange={setAssigneeInput}
                  focus={true}
                  suggestions={assignees}
                  onSubmit={() => {
                    const targetIds = (activeOverlay as { targetIds: string[] })
                      .targetIds;
                    closeOverlay();
                    void (async () => {
                      const assignee = assigneeInput.trim();
                      for (const id of targetIds) {
                        await backend.cachedUpdateWorkItem(id, { assignee });
                        await queueWrite('update', id);
                      }
                      setAssigneeInput('');
                      refreshData();
                    })();
                  }}
                />
              </Box>
            ) : activeOverlay?.type === 'labels-input' ? (
              <Box flexDirection="column">
                <Text color="cyan">
                  Set labels for {activeOverlay.targetIds.length} item
                  {activeOverlay.targetIds.length > 1 ? 's' : ''}{' '}
                  (comma-separated):
                </Text>
                <MultiAutocompleteInput
                  value={labelsInput}
                  onChange={setLabelsInput}
                  focus={true}
                  suggestions={labelSuggestions}
                  onSubmit={() => {
                    const targetIds = (activeOverlay as { targetIds: string[] })
                      .targetIds;
                    closeOverlay();
                    void (async () => {
                      const labels = labelsInput
                        .split(',')
                        .map((l) => l.trim())
                        .filter(Boolean);
                      for (const id of targetIds) {
                        await backend.cachedUpdateWorkItem(id, { labels });
                        await queueWrite('update', id);
                      }
                      setLabelsInput('');
                      refreshData();
                    })();
                  }}
                />
              </Box>
            ) : activeOverlay?.type === 'delete-confirm' ? (
              <Text color="red">
                Delete{' '}
                {(activeOverlay as { targetIds: string[] }).targetIds.length}{' '}
                item
                {(activeOverlay as { targetIds: string[] }).targetIds.length > 1
                  ? 's'
                  : ''}
                ? (y/n)
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
          {updateInfo?.updateAvailable && activeOverlay === null && (
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
