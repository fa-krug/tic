import { useState, useMemo, useEffect, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';

import {
  navigationStore,
  useNavigationStore,
} from '../stores/navigationStore.js';
import { listViewStore, useListViewStore } from '../stores/listViewStore.js';
import { isGitRepo } from '../git.js';
import { beginImplementation } from '../implement.js';
import { configStore, useConfigStore } from '../stores/configStore.js';
import { uiStore, useUIStore, getOverlayTargetIds } from '../stores/uiStore.js';
import { TableLayout } from './TableLayout.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { useScrollViewport } from '../hooks/useScrollViewport.js';
import {
  useBackendDataStore,
  backendDataStore,
} from '../stores/backendDataStore.js';
import { useShallow } from 'zustand/shallow';
import { SyncQueueStore } from '../sync/queue.js';
import type { QueueAction } from '../sync/types.js';
import { buildTree, type TreeItem } from './buildTree.js';
import {
  getVisibleCommands,
  type Command,
  type CommandContext,
} from '../commands.js';
import { OverlayPanel, type OverlayItem } from './OverlayPanel.js';
import { DetailPanel } from './DetailPanel.js';
import type { WorkItem, Template } from '../types.js';
import { undoStore } from '../stores/undoStore.js';
import { isSoftDeleteBackend } from '../backends/types.js';
export type { TreeItem } from './buildTree.js';

type BulkAction =
  | 'status'
  | 'iteration'
  | 'parent'
  | 'type'
  | 'priority'
  | 'assignee'
  | 'labels'
  | 'delete';

export function getTargetIds(
  markedIds: Set<string>,
  cursorItem: { id: string } | undefined,
): string[] {
  if (markedIds.size > 0) {
    return [...markedIds];
  }
  return cursorItem ? [cursorItem.id] : [];
}

export function buildHelpText(availableWidth: number): string {
  const shortcuts = [
    { key: '↑↓', label: 'navigate' },
    { key: '←→', label: 'expand' },
    { key: 'enter', label: 'edit' },
    { key: 'c', label: 'create' },
    { key: 'd', label: 'delete' },
    { key: 'u', label: 'undo' },
    { key: '/', label: 'search' },
    { key: ',', label: 'settings' },
    { key: '?', label: 'help' },
  ];
  const sep = '  ';
  let result = '';
  for (const s of shortcuts) {
    const entry = `${s.key} ${s.label}`;
    const candidate = result ? result + sep + entry : entry;
    if (candidate.length > availableWidth) break;
    result = candidate;
  }
  return result;
}

export function WorkItemList() {
  // Backend data store - split by change frequency for minimal re-renders

  // Rarely changes (individual selectors)
  const backend = useBackendDataStore((s) => s.backend);
  const syncManager = useBackendDataStore((s) => s.syncManager);
  const capabilities = useBackendDataStore((s) => s.capabilities);

  // Changes on data refresh (grouped with useShallow)
  const {
    items: allItems,
    types,
    statuses,
    assignees,
    labels: labelSuggestions,
  } = useBackendDataStore(
    useShallow((s) => ({
      items: s.items,
      types: s.types,
      statuses: s.statuses,
      assignees: s.assignees,
      labels: s.labels,
    })),
  );

  // Changes independently (individual selectors)
  const iteration = useBackendDataStore((s) => s.currentIteration);
  const loading = useBackendDataStore((s) => s.loading);
  const initError = useBackendDataStore((s) => s.error);

  // Navigation store — actions via getState() (stable, never trigger re-renders)
  const {
    navigate,
    navigateToHelp,
    selectWorkItem,
    setActiveType,
    setActiveTemplate,
    setFormMode,
    setSettingsInitialFocus,
  } = navigationStore.getState();

  // Only reactive data via hooks
  const activeType = useNavigationStore((s) => s.activeType);
  const updateInfo = useNavigationStore((s) => s.updateInfo);

  const defaultType = useConfigStore((s) => s.config.defaultType ?? null);
  const branchMode = useConfigStore((s) => s.config.branchMode ?? 'worktree');
  const showDetailPanel = useConfigStore(
    (s) => s.config.showDetailPanel ?? true,
  );
  const { exit } = useApp();

  // Store selectors for persistent list view state
  const { cursor, markedIds, expandedIds } = useListViewStore(
    useShallow((s) => ({
      cursor: s.cursor,
      markedIds: s.markedIds,
      expandedIds: s.expandedIds,
    })),
  );
  const {
    setCursor,
    toggleExpanded,
    toggleMarked,
    clearMarked,
    clampCursor,
    removeDeletedItem,
  } = listViewStore.getState();

  // Local state for inputs and templates
  const [allSearchItems, setAllSearchItems] = useState<WorkItem[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [descriptionScrollOffset, setDescriptionScrollOffset] = useState(0);

  // UI overlay state from store
  const { activeOverlay, warning, toast } = useUIStore(
    useShallow((s) => ({
      activeOverlay: s.activeOverlay,
      warning: s.warning,
      toast: s.toast,
    })),
  );
  const {
    openOverlay,
    closeOverlay,
    setWarning,
    clearWarning,
    setToast,
    clearToast,
  } = uiStore.getState();

  // Marked count for header display
  const markedCount = markedIds.size;
  const refreshData = useCallback(() => {
    void backendDataStore.getState().refresh();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => clearToast(), 3000);
    return () => clearTimeout(timer);
  }, [toast, clearToast]);

  useEffect(() => {
    if (!warning) return;
    const timer = setTimeout(() => clearWarning(), 5000);
    return () => clearTimeout(timer);
  }, [warning, clearWarning]);

  useEffect(() => {
    if (capabilities.templates && backend) {
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
      syncManager?.pushPending().catch(() => {});
    }
  };

  const pushUpdateUndo = (targetIds: string[], label: string) => {
    const snapshots = targetIds
      .map((id) => allItems.find((i) => i.id === id))
      .filter((i): i is WorkItem => i !== undefined);
    undoStore.getState().pushUndo({
      type: 'update',
      label,
      itemSnapshots: snapshots,
      syncItemIds: [...targetIds],
      syncAction: 'update',
    });
  };

  const { width: terminalWidth, height: terminalHeight } = useTerminalSize();
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
  // expandedIds comes from listViewStore (imported above)

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
    clampCursor(treeItems.length - 1);
  }, [treeItems.length, clampCursor]);

  useEffect(() => {
    setShowFullDescription(false);
    setDescriptionScrollOffset(0);
  }, [cursor]);

  useEffect(() => {
    if (activeOverlay?.type !== 'search' || !backend) return;
    let cancelled = false;
    void backend.listWorkItems().then((items) => {
      if (!cancelled) setAllSearchItems(items);
    });
    return () => {
      cancelled = true;
    };
  }, [activeOverlay?.type, backend]);

  // Description viewport calculation
  const currentItem = treeItems[cursor]?.item;
  const descriptionLines = currentItem?.description?.split('\n') ?? [];
  const descriptionTotalLines = descriptionLines.length;
  const hasDescription = (currentItem?.description?.trim().length ?? 0) > 0;

  const minListRows = 2;
  const baseChromeLines = 6; // title+margin(2) + table header(1) + help bar margin+text(2) + warning(1)
  const panelBaseLines = 5; // marginTop(1) + title height(2) + meta(1) + priority/labels(1)
  const separatorLine = 1;

  const maxDescriptionHeight = showFullDescription
    ? Math.max(
        1,
        terminalHeight -
          baseChromeLines -
          panelBaseLines -
          separatorLine -
          minListRows,
      )
    : 0;

  const actualDescriptionViewHeight = showFullDescription
    ? Math.min(descriptionTotalLines, maxDescriptionHeight) + separatorLine
    : 0;

  const previewLine =
    showDetailPanel && hasDescription && !showFullDescription ? 1 : 0;

  const chromeLines = showDetailPanel
    ? 11 + previewLine + actualDescriptionViewHeight
    : 6;

  const viewport = useScrollViewport({
    totalItems: treeItems.length,
    cursor,
    chromeLines,
    linesPerItem: 1,
  });

  // Block 1.5: Description scroll handler — active when full description is shown
  useInput(
    (_input, key) => {
      if (_input === ' ' || key.escape) {
        setShowFullDescription(false);
        setDescriptionScrollOffset(0);
        return;
      }
      if (key.upArrow) {
        setDescriptionScrollOffset((o) => Math.max(0, o - 1));
      }
      if (key.downArrow) {
        const maxScroll = Math.max(
          0,
          descriptionTotalLines - maxDescriptionHeight,
        );
        setDescriptionScrollOffset((o) => Math.min(maxScroll, o + 1));
      }
    },
    { isActive: showFullDescription && activeOverlay === null },
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
        setCursor(Math.max(0, cursor - 1));
        clearWarning();
      }
      if (key.downArrow) {
        setCursor(Math.min(treeItems.length - 1, cursor + 1));
        clearWarning();
      }
      if (key.pageUp) {
        setCursor(Math.max(0, cursor - viewport.maxVisible));
        clearWarning();
      }
      if (key.pageDown) {
        setCursor(Math.min(treeItems.length - 1, cursor + viewport.maxVisible));
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
          toggleExpanded(current.item.id);
        }
      }

      if (key.leftArrow && treeItems.length > 0) {
        const current = treeItems[cursor];
        if (current) {
          if (current.hasChildren && !collapsedIds.has(current.item.id)) {
            toggleExpanded(current.item.id);
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
      if (input === ',') {
        if (updateInfo?.updateAvailable) {
          setSettingsInitialFocus('update-now');
        }
        navigate('settings');
      }

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

      if (input === 'u') {
        const entry = undoStore.getState().popUndo();
        if (!entry || !backend) return;
        void (async () => {
          if (entry.type === 'delete') {
            if (isSoftDeleteBackend(backend)) {
              for (const snap of entry.itemSnapshots) {
                await backend.restoreWorkItem(snap.id);
              }
            }
            if (queueStore) {
              await queueStore.removeByIds(entry.syncItemIds, 'delete');
            }
            refreshData();
            setToast(
              entry.itemSnapshots.length === 1
                ? `Restored #${entry.itemSnapshots[0]!.id}`
                : `Restored ${entry.itemSnapshots.length} items`,
            );
          } else if (entry.type === 'create') {
            for (const id of entry.createdIds ?? []) {
              await backend.cachedDeleteWorkItem(id);
            }
            if (queueStore) {
              await queueStore.removeByIds(entry.syncItemIds, 'create');
            }
            refreshData();
            setToast(
              (entry.createdIds?.length ?? 0) === 1
                ? `Undid create #${entry.createdIds?.[0]}`
                : `Undid create of ${entry.createdIds?.length} items`,
            );
          } else if (entry.type === 'update') {
            for (const snap of entry.itemSnapshots) {
              await backend.cachedUpdateWorkItem(snap.id, snap);
            }
            if (queueStore) {
              await queueStore.removeByIds(entry.syncItemIds, 'update');
            }
            for (const snap of entry.itemSnapshots) {
              await queueWrite('update', snap.id);
            }
            refreshData();
            setToast(`Undid ${entry.label}`);
          }
        })();
      }

      if (input === 'o' && treeItems.length > 0 && backend) {
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

      if (input === 'S') {
        navigate('status');
      }

      if (input === 's' && treeItems.length > 0) {
        const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
        if (targetIds.length > 0) {
          openOverlay({ type: 'status-picker', targetIds });
        }
      }

      if (input === 'v') {
        void configStore
          .getState()
          .update({ showDetailPanel: !showDetailPanel });
      }

      if (input === ' ' && showDetailPanel && hasDescription) {
        setShowFullDescription(true);
        setDescriptionScrollOffset(0);
      }

      if (input === 'p' && capabilities.fields.parent && treeItems.length > 0) {
        const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
        if (targetIds.length > 0) {
          openOverlay({ type: 'parent-input', targetIds });
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
        toggleMarked(itemId);
      }

      if (input === 'M') {
        clearMarked();
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
        }
      }

      if (input === 'l' && capabilities.fields.labels && treeItems.length > 0) {
        const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
        if (targetIds.length > 0) {
          openOverlay({ type: 'labels-input', targetIds });
        }
      }

      if (input === 't' && capabilities.customTypes && treeItems.length > 0) {
        const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
        if (targetIds.length > 0) {
          openOverlay({ type: 'type-picker', targetIds });
        }
      }
    },
    { isActive: activeOverlay === null && !showFullDescription },
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
        if (treeItems[cursor] && backend) {
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
          toggleMarked(itemId);
        }
        break;
      case 'clear-marks':
        clearMarked();
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
          }
        }
        break;
      case 'set-labels':
        {
          const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
          if (targetIds.length > 0) {
            openOverlay({ type: 'labels-input', targetIds });
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
        break;
      case 'type':
        openOverlay({ type: 'type-picker', targetIds });
        break;
      case 'priority':
        openOverlay({ type: 'priority-picker', targetIds });
        break;
      case 'assignee':
        openOverlay({ type: 'assignee-input', targetIds });
        break;
      case 'labels':
        openOverlay({ type: 'labels-input', targetIds });
        break;
      case 'delete':
        openOverlay({ type: 'delete-confirm', targetIds });
        break;
    }
  };

  const typeLabel = activeType
    ? activeType.charAt(0).toUpperCase() + activeType.slice(1) + 's'
    : '';

  const visibleTreeItems = useMemo(
    () => treeItems.slice(viewport.start, viewport.end),
    [treeItems, viewport.start, viewport.end],
  );

  const positionText =
    treeItems.length > viewport.maxVisible
      ? `${cursor + 1}/${treeItems.length}`
      : '';

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text wrap="truncate">
          <Text bold color="cyan">
            {typeLabel} — {iteration}
          </Text>
          <Text dimColor>{` (${items.length} items)`}</Text>
          {markedCount > 0 && (
            <Text color="magenta">{` ● ${markedCount} marked`}</Text>
          )}
        </Text>
      </Box>

      <TableLayout
        treeItems={visibleTreeItems}
        cursor={viewport.visibleCursor}
        capabilities={capabilities}
        collapsedIds={collapsedIds}
        markedIds={markedIds}
        terminalWidth={terminalWidth}
      />

      {treeItems.length === 0 && !loading && initError && (
        <Box marginTop={1} flexDirection="column">
          <Text color="red">Failed to connect to backend:</Text>
          <Box marginLeft={2}>
            <Text color="red">{initError}</Text>
          </Box>
          <Text dimColor>Press , for settings or q to quit.</Text>
        </Box>
      )}
      {treeItems.length === 0 && !loading && !initError && (
        <Box marginTop={1}>
          <Text dimColor>
            No {activeType ?? 'item'}s in this iteration. Press c to create, /
            to search all.
          </Text>
        </Box>
      )}
      {loading && treeItems.length === 0 && (
        <Box marginTop={1}>
          <Text dimColor>Loading...</Text>
        </Box>
      )}

      {showDetailPanel && treeItems.length > 0 && treeItems[cursor] && (
        <DetailPanel
          item={treeItems[cursor].item}
          terminalWidth={terminalWidth}
          showFullDescription={showFullDescription}
          descriptionScrollOffset={descriptionScrollOffset}
          maxDescriptionHeight={maxDescriptionHeight}
        />
      )}

      <Box marginTop={1}>
        {showFullDescription ? (
          <Box>
            <Text dimColor>↑↓ scroll space/esc close</Text>
            {positionText && <Text dimColor> {positionText}</Text>}
          </Box>
        ) : activeOverlay?.type === 'search' ? (
          (() => {
            const searchItems: OverlayItem[] = allSearchItems.map((item) => ({
              id: item.id,
              label: `#${item.id} ${item.title}`,
              value: item.id,
              hint: item.type,
              category:
                item.iteration === iteration
                  ? 'Current iteration'
                  : (item.iteration ?? 'No iteration'),
            }));
            return (
              <OverlayPanel
                title="Search"
                items={searchItems}
                placeholder="Type to search..."
                onSelect={(selected) => {
                  const item = allSearchItems.find(
                    (i) => i.id === selected.value,
                  );
                  if (item) handleSearchSelect(item);
                }}
                onCancel={handleSearchCancel}
              />
            );
          })()
        ) : activeOverlay?.type === 'bulk-menu' ? (
          (() => {
            const bulkItems: OverlayItem[] = [];
            bulkItems.push({
              id: 'status',
              label: 'Set status...',
              value: 'status',
              hint: 's',
            });
            if (capabilities.iterations) {
              bulkItems.push({
                id: 'iteration',
                label: 'Set iteration...',
                value: 'iteration',
                hint: 'i',
              });
            }
            if (capabilities.fields.parent) {
              bulkItems.push({
                id: 'parent',
                label: 'Set parent...',
                value: 'parent',
                hint: 'p',
              });
            }
            if (capabilities.customTypes) {
              bulkItems.push({
                id: 'type',
                label: 'Set type...',
                value: 'type',
                hint: 't',
              });
            }
            if (capabilities.fields.priority) {
              bulkItems.push({
                id: 'priority',
                label: 'Set priority...',
                value: 'priority',
                hint: 'P',
              });
            }
            if (capabilities.fields.assignee) {
              bulkItems.push({
                id: 'assignee',
                label: 'Set assignee...',
                value: 'assignee',
                hint: 'a',
              });
            }
            if (capabilities.fields.labels) {
              bulkItems.push({
                id: 'labels',
                label: 'Set labels...',
                value: 'labels',
                hint: 'l',
              });
            }
            bulkItems.push({
              id: 'delete',
              label: 'Delete',
              value: 'delete',
              hint: 'd',
            });
            const count = markedIds.size > 0 ? markedIds.size : 1;
            return (
              <OverlayPanel
                title={`Bulk Actions (${count} ${count === 1 ? 'item' : 'items'})`}
                items={bulkItems}
                onSelect={(item) => {
                  closeOverlay();
                  handleBulkAction(item.value as BulkAction);
                }}
                onCancel={() => closeOverlay()}
              />
            );
          })()
        ) : activeOverlay?.type === 'command-palette' ? (
          <OverlayPanel
            title="Commands"
            items={paletteCommands.map((cmd) => ({
              id: cmd.id,
              label: cmd.label,
              value: cmd.id,
              hint: cmd.shortcut,
              category: cmd.category,
            }))}
            placeholder="Type a command..."
            onSelect={(item) => {
              const cmd = paletteCommands.find((c) => c.id === item.value);
              if (cmd) handleCommandSelect(cmd);
            }}
            onCancel={() => closeOverlay()}
          />
        ) : activeOverlay?.type === 'status-picker' ? (
          <OverlayPanel
            title="Set Status"
            items={statuses.map((s) => ({ id: s, label: s, value: s }))}
            onSelect={(item) => {
              const targetIds = getOverlayTargetIds();
              closeOverlay();
              if (!backend) return;
              void (async () => {
                pushUpdateUndo(targetIds, 'status change');
                for (const id of targetIds) {
                  await backend.cachedUpdateWorkItem(id, {
                    status: item.value,
                  });
                  await queueWrite('update', id);
                }
                refreshData();
                setToast(
                  targetIds.length === 1
                    ? 'Status updated — press u to undo'
                    : `${targetIds.length} items updated — press u to undo`,
                );
              })();
            }}
            onCancel={() => closeOverlay()}
          />
        ) : activeOverlay?.type === 'type-picker' ? (
          <OverlayPanel
            title="Set Type"
            items={types.map((t) => ({
              id: t,
              label: t.charAt(0).toUpperCase() + t.slice(1),
              value: t,
            }))}
            onSelect={(item) => {
              const targetIds = getOverlayTargetIds();
              closeOverlay();
              if (!backend) return;
              void (async () => {
                pushUpdateUndo(targetIds, 'type change');
                for (const id of targetIds) {
                  await backend.cachedUpdateWorkItem(id, {
                    type: item.value,
                  });
                  await queueWrite('update', id);
                }
                refreshData();
                setToast(
                  targetIds.length === 1
                    ? 'Type updated — press u to undo'
                    : `${targetIds.length} items updated — press u to undo`,
                );
              })();
            }}
            onCancel={() => closeOverlay()}
          />
        ) : activeOverlay?.type === 'priority-picker' ? (
          <OverlayPanel
            title="Set Priority"
            items={[
              { id: 'critical', label: 'Critical', value: 'critical' },
              { id: 'high', label: 'High', value: 'high' },
              { id: 'medium', label: 'Medium', value: 'medium' },
              { id: 'low', label: 'Low', value: 'low' },
            ]}
            onSelect={(item) => {
              const targetIds = getOverlayTargetIds();
              closeOverlay();
              if (!backend) return;
              const priority = item.value as
                | 'low'
                | 'medium'
                | 'high'
                | 'critical';
              void (async () => {
                pushUpdateUndo(targetIds, 'priority change');
                for (const id of targetIds) {
                  await backend.cachedUpdateWorkItem(id, { priority });
                  await queueWrite('update', id);
                }
                refreshData();
                setToast(
                  targetIds.length === 1
                    ? 'Priority updated — press u to undo'
                    : `${targetIds.length} items updated — press u to undo`,
                );
              })();
            }}
            onCancel={() => closeOverlay()}
          />
        ) : activeOverlay?.type === 'template-picker' ? (
          <OverlayPanel
            title="Select Template"
            items={[
              { id: '__none__', label: 'No template', value: '__none__' },
              ...templates.map((t) => ({
                id: t.slug,
                label: t.name,
                value: t.slug,
              })),
            ]}
            onSelect={(item) => {
              closeOverlay();
              setFormMode('item');
              if (item.value === '__none__') {
                setActiveTemplate(null);
              } else {
                const template = templates.find((t) => t.slug === item.value);
                setActiveTemplate(template ?? null);
              }
              selectWorkItem(null);
              navigate('form');
            }}
            onCancel={() => closeOverlay()}
          />
        ) : activeOverlay?.type === 'parent-input' ? (
          <OverlayPanel
            title={`Set Parent (${activeOverlay.targetIds.length} item${activeOverlay.targetIds.length > 1 ? 's' : ''})`}
            items={parentSuggestions.map((s) => ({
              id: s,
              label: s,
              value: s,
            }))}
            allowFreeform
            onSelect={(item) => {
              const targetIds = getOverlayTargetIds();
              if (!backend) return;
              void (async () => {
                const raw = item.value.trim();
                const newParent = raw.includes(' - ')
                  ? raw.split(' - ')[0]!.trim()
                  : raw;
                try {
                  pushUpdateUndo(targetIds, 'parent change');
                  for (const id of targetIds) {
                    await backend.cachedUpdateWorkItem(id, {
                      parent: newParent,
                    });
                    await queueWrite('update', id);
                  }
                  clearWarning();
                } catch (e) {
                  setWarning(e instanceof Error ? e.message : 'Invalid parent');
                }
                closeOverlay();
                refreshData();
                setToast(
                  targetIds.length === 1
                    ? 'Parent updated — press u to undo'
                    : `${targetIds.length} items updated — press u to undo`,
                );
              })();
            }}
            onSubmitFreeform={(text) => {
              const targetIds = getOverlayTargetIds();
              if (!backend) return;
              void (async () => {
                const raw = text.trim();
                const newParent =
                  raw === ''
                    ? null
                    : raw.includes(' - ')
                      ? raw.split(' - ')[0]!.trim()
                      : raw;
                try {
                  pushUpdateUndo(targetIds, 'parent change');
                  for (const id of targetIds) {
                    await backend.cachedUpdateWorkItem(id, {
                      parent: newParent,
                    });
                    await queueWrite('update', id);
                  }
                  clearWarning();
                } catch (e) {
                  setWarning(e instanceof Error ? e.message : 'Invalid parent');
                }
                closeOverlay();
                refreshData();
                setToast(
                  targetIds.length === 1
                    ? 'Parent updated — press u to undo'
                    : `${targetIds.length} items updated — press u to undo`,
                );
              })();
            }}
            onCancel={() => closeOverlay()}
            placeholder="Type parent ID or title..."
            emptyMessage="Type a parent ID (empty to clear)"
          />
        ) : activeOverlay?.type === 'assignee-input' ? (
          <OverlayPanel
            title={`Set Assignee (${activeOverlay.targetIds.length} item${activeOverlay.targetIds.length > 1 ? 's' : ''})`}
            items={assignees.map((a) => ({ id: a, label: a, value: a }))}
            allowFreeform
            onSelect={(item) => {
              const targetIds = getOverlayTargetIds();
              closeOverlay();
              if (!backend) return;
              void (async () => {
                pushUpdateUndo(targetIds, 'assignee change');
                for (const id of targetIds) {
                  await backend.cachedUpdateWorkItem(id, {
                    assignee: item.value.trim(),
                  });
                  await queueWrite('update', id);
                }
                refreshData();
                setToast(
                  targetIds.length === 1
                    ? 'Assignee updated — press u to undo'
                    : `${targetIds.length} items updated — press u to undo`,
                );
              })();
            }}
            onSubmitFreeform={(text) => {
              const targetIds = getOverlayTargetIds();
              closeOverlay();
              if (!backend) return;
              void (async () => {
                pushUpdateUndo(targetIds, 'assignee change');
                for (const id of targetIds) {
                  await backend.cachedUpdateWorkItem(id, {
                    assignee: text.trim(),
                  });
                  await queueWrite('update', id);
                }
                refreshData();
                setToast(
                  targetIds.length === 1
                    ? 'Assignee updated — press u to undo'
                    : `${targetIds.length} items updated — press u to undo`,
                );
              })();
            }}
            onCancel={() => closeOverlay()}
            placeholder="Type assignee name..."
          />
        ) : activeOverlay?.type === 'labels-input' ? (
          <OverlayPanel
            title={`Set Labels (${activeOverlay.targetIds.length} item${activeOverlay.targetIds.length > 1 ? 's' : ''})`}
            items={labelSuggestions.map((l) => ({
              id: l,
              label: l,
              value: l,
            }))}
            multiSelect
            allowFreeform
            onSelect={() => {}}
            onConfirm={(selected) => {
              const targetIds = getOverlayTargetIds();
              closeOverlay();
              if (!backend) return;
              void (async () => {
                pushUpdateUndo(targetIds, 'labels change');
                const labels = selected.map((i) => i.value);
                for (const id of targetIds) {
                  await backend.cachedUpdateWorkItem(id, { labels });
                  await queueWrite('update', id);
                }
                refreshData();
                setToast(
                  targetIds.length === 1
                    ? 'Labels updated — press u to undo'
                    : `${targetIds.length} items updated — press u to undo`,
                );
              })();
            }}
            onSubmitFreeform={(text) => {
              const targetIds = getOverlayTargetIds();
              closeOverlay();
              if (!backend) return;
              void (async () => {
                pushUpdateUndo(targetIds, 'labels change');
                const labels = text
                  .split(',')
                  .map((l) => l.trim())
                  .filter(Boolean);
                for (const id of targetIds) {
                  await backend.cachedUpdateWorkItem(id, { labels });
                  await queueWrite('update', id);
                }
                refreshData();
                setToast(
                  targetIds.length === 1
                    ? 'Labels updated — press u to undo'
                    : `${targetIds.length} items updated — press u to undo`,
                );
              })();
            }}
            onCancel={() => closeOverlay()}
            placeholder="Type to filter labels..."
          />
        ) : activeOverlay?.type === 'delete-confirm' ? (
          <OverlayPanel
            title={`Delete ${activeOverlay.targetIds.length} item${activeOverlay.targetIds.length > 1 ? 's' : ''}?`}
            items={[
              { id: 'yes', label: 'Yes, delete', value: 'yes' },
              { id: 'no', label: 'Cancel', value: 'no' },
            ]}
            onSelect={(item) => {
              if (item.value === 'yes') {
                const targetIds = activeOverlay.targetIds;
                if (!backend) return;
                void (async () => {
                  const snapshots = targetIds
                    .map((id) => allItems.find((i) => i.id === id))
                    .filter((i): i is WorkItem => i !== undefined);
                  const softDelete = isSoftDeleteBackend(backend);
                  for (const id of targetIds) {
                    if (softDelete) {
                      await backend.softDeleteWorkItem(id);
                    } else {
                      await backend.cachedDeleteWorkItem(id);
                    }
                    await queueWrite('delete', id);
                  }
                  const evicted = undoStore.getState().pushUndo({
                    type: 'delete',
                    label:
                      targetIds.length === 1
                        ? `deleted #${targetIds[0]}`
                        : `deleted ${targetIds.length} items`,
                    itemSnapshots: snapshots,
                    syncItemIds: [...targetIds],
                    syncAction: 'delete',
                  });
                  if (evicted?.type === 'delete' && softDelete) {
                    for (const snap of evicted.itemSnapshots) {
                      await backend.permanentlyDeleteWorkItem(snap.id);
                    }
                  }
                  closeOverlay();
                  for (const id of targetIds) {
                    removeDeletedItem(id);
                  }
                  setCursor(Math.max(0, cursor - 1));
                  refreshData();
                  setToast(
                    targetIds.length === 1
                      ? `Item #${targetIds[0]} deleted — press u to undo`
                      : `${targetIds.length} items deleted — press u to undo`,
                  );
                })();
              } else {
                closeOverlay();
              }
            }}
            onCancel={() => closeOverlay()}
          />
        ) : toast ? (
          <Box>
            <Text color="green">{toast.message}</Text>
            {positionText && <Text dimColor> {positionText}</Text>}
          </Box>
        ) : (
          <Box>
            <Text dimColor>
              {buildHelpText(
                terminalWidth - (positionText ? positionText.length + 2 : 0),
              )}
            </Text>
            {positionText && <Text dimColor> {positionText}</Text>}
          </Box>
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
            Update available: {updateInfo.current} → {updateInfo.latest} Press ,
            to update in Settings
          </Text>
        </Box>
      )}
    </Box>
  );
}
