import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Box, Text, useInput, useApp } from 'ink';

import {
  navigationStore,
  useNavigationStore,
} from '../stores/navigationStore.js';
import { listViewStore, useListViewStore } from '../stores/listViewStore.js';
import { isGitRepo, getCurrentBranch, slugify } from '../git.js';
import { beginImplementation } from '../implement.js';
import { configStore, useConfigStore } from '../stores/configStore.js';
import { uiStore, useUIStore, getOverlayTargetIds } from '../stores/uiStore.js';
import { getMarkedDistribution } from './getMarkedDistribution.js';
import { TableLayout } from './TableLayout.js';
import type { ColumnDef } from './TableLayout.js';
import { ColorPill } from './ColorPill.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { useScrollViewport } from '../hooks/useScrollViewport.js';
import {
  useBackendDataStore,
  backendDataStore,
} from '../stores/backendDataStore.js';
import { useShallow } from 'zustand/shallow';
import type { QueueAction } from '../sync/types.js';
import { buildTree, sortTree, type TreeItem } from './buildTree.js';
import type { SortColumn, SortEntry } from '../stores/listViewStore.js';
import {
  getVisibleCommands,
  buildFooterHints,
  matchesCommand,
  type Command,
  type CommandContext,
} from '../commands.js';
import { OverlayPanel, type OverlayItem } from './OverlayPanel.js';
import { DetailPanel } from './DetailPanel.js';
import type { WorkItem, Template } from '../types.js';
import { undoStore } from '../stores/undoStore.js';
import { CommandBar } from './CommandBar.js';
import { isSoftDeleteBackend } from '../backends/types.js';
import type { BackendCapabilities } from '../backends/types.js';

import { filterStore, useFilterStore } from '../stores/filterStore.js';
import { useThemeStore } from '../stores/themeStore.js';
import {
  applyFilters,
  countActiveFilters,
  summarizeFilters,
  type ViewFilters,
  type SavedView,
} from '../filters.js';
export type { TreeItem } from './buildTree.js';

const EMPTY_VIEWS: SavedView[] = [];

function buildWorkItemColumns(
  capabilities: BackendCapabilities,
  collapsedIds: Set<string>,
  accent: string,
): ColumnDef<TreeItem>[] {
  const columns: ColumnDef<TreeItem>[] = [];

  // ID column
  columns.push({
    key: 'id',
    header: 'ID',
    width: 4, // overridden dynamically via useMemo
    required: true,
    sortable: true,
    render: (ti, selected) => (
      <Text
        color={selected ? accent : undefined}
        bold={selected}
        dimColor={ti.isCrossType && !selected}
      >
        {ti.item.id}
      </Text>
    ),
  });

  // Title column (flex)
  columns.push({
    key: 'title',
    header: 'Title',
    width: -1,
    required: true,
    sortable: true,
    render: (ti, selected) => {
      const { item, prefix, isCrossType, hasChildren } = ti;
      const collapseIndicator = hasChildren
        ? collapsedIds.has(item.id)
          ? '\u25B6 '
          : '\u25BC '
        : '  ';
      const typeLabel = isCrossType ? ` (${item.type})` : '';
      return (
        <Text
          color={selected ? accent : undefined}
          bold={selected}
          dimColor={isCrossType && !selected}
          wrap="truncate"
        >
          {capabilities.relationships ? prefix : ''}
          {collapseIndicator}
          {item.title}
          {typeLabel}
        </Text>
      );
    },
  });

  // Status column
  columns.push({
    key: 'status',
    header: 'Status',
    width: 14,
    hidePriority: 3,
    sortable: true,
    render: (ti, selected) => {
      const hasUnresolvedDeps = ti.item.dependsOn.length > 0;
      return (
        <>
          {capabilities.fields.dependsOn && hasUnresolvedDeps && (
            <Text dimColor={ti.isCrossType && !selected}>{'\u29D7'} </Text>
          )}
          <ColorPill field="status" value={ti.item.status} />
        </>
      );
    },
  });

  // Assignee column (conditional)
  if (capabilities.fields.assignee) {
    columns.push({
      key: 'assignee',
      header: 'Assignee',
      width: 20,
      hidePriority: 4,
      sortable: true,
      hasData: (items) => items.some(({ item }) => !!item.assignee),
      render: (ti, selected) => (
        <Text
          color={selected ? accent : undefined}
          bold={selected}
          dimColor={ti.isCrossType && !selected}
          wrap="truncate"
        >
          {ti.item.assignee}
        </Text>
      ),
    });
  }

  // Labels column (conditional)
  if (capabilities.fields.labels) {
    columns.push({
      key: 'labels',
      header: 'Labels',
      width: 20,
      hidePriority: 2,
      hasData: (items) => items.some(({ item }) => item.labels.length > 0),
      render: (ti) => {
        const maxWidth = 20;
        const rendered: string[] = [];
        let usedWidth = 0;
        for (const label of ti.item.labels) {
          const pillWidth = label.length + 2;
          const needed = usedWidth === 0 ? pillWidth : pillWidth + 1;
          if (usedWidth + needed > maxWidth) {
            const remaining = ti.item.labels.length - rendered.length;
            if (remaining > 0) {
              return (
                <Box gap={1}>
                  {rendered.map((l) => (
                    <ColorPill key={l} field="label" value={l} />
                  ))}
                  <Text dimColor>+{remaining}</Text>
                </Box>
              );
            }
            break;
          }
          rendered.push(label);
          usedWidth += needed;
        }
        return (
          <Box gap={1}>
            {rendered.map((l) => (
              <ColorPill key={l} field="label" value={l} />
            ))}
          </Box>
        );
      },
    });
  }

  // Priority column (conditional)
  if (capabilities.fields.priority) {
    columns.push({
      key: 'priority',
      header: 'Priority',
      width: 12,
      hidePriority: 1,
      sortable: true,
      hasData: (items) => items.some(({ item }) => !!item.priority),
      render: (ti) =>
        ti.item.priority ? (
          <ColorPill field="priority" value={ti.item.priority} />
        ) : (
          <Text> </Text>
        ),
    });
  }

  return columns;
}

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

export function WorkItemList() {
  const {
    accent,
    success,
    error: errorColor,
    warning: warningColor,
    marked,
    mutedDim,
  } = useThemeStore((s) => s.colors);

  // Backend data store - split by change frequency for minimal re-renders

  // Rarely changes (individual selectors)
  const backend = useBackendDataStore((s) => s.backend);
  const syncManager = useBackendDataStore((s) => s.syncManager);
  const capabilities = useBackendDataStore((s) => s.capabilities);
  const prCapabilities = useBackendDataStore((s) => s.prCapabilities);

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
  const branchCommand = useConfigStore((s) => s.config.branchCommand);
  const copyToClipboard = useConfigStore((s) => s.config.copyToClipboard);
  const showDetailPanel = useConfigStore(
    (s) => s.config.showDetailPanel ?? true,
  );
  const savedViews = useConfigStore((s) => s.config.views ?? EMPTY_VIEWS);
  const defaultView = useConfigStore((s) => s.config.defaultView);
  const { exit } = useApp();

  // Store selectors for persistent list view state
  const { cursor, markedIds, expandedIds, rangeAnchor, sortStack } =
    useListViewStore(
      useShallow((s) => ({
        cursor: s.cursor,
        markedIds: s.markedIds,
        expandedIds: s.expandedIds,
        rangeAnchor: s.rangeAnchor,
        sortStack: s.sortStack,
      })),
    );
  const { activeFilters, activeViewName, lastViewName } = useFilterStore(
    useShallow((s) => ({
      activeFilters: s.activeFilters,
      activeViewName: s.activeViewName,
      lastViewName: s.lastViewName,
    })),
  );
  const filterCount = useMemo(
    () => countActiveFilters(activeFilters),
    [activeFilters],
  );

  const {
    setCursor,
    toggleExpanded,
    toggleMarked,
    clearMarked,
    setMarkedIds,
    setRangeAnchor,
    clampCursor,
    removeDeletedItem,
    toggleSortColumn,
    clearSort,
  } = listViewStore.getState();

  // Local state for inputs and templates
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
    void backendDataStore
      .getState()
      .refresh()
      .catch(() => {});
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
    if (!capabilities.templates || !backend) return;
    let cancelled = false;
    void backend
      .listTemplates()
      .then((t) => {
        if (!cancelled) setTemplates(t);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        uiStore
          .getState()
          .setToast(
            err instanceof Error ? err.message : 'Failed to load templates',
          );
      });
    return () => {
      cancelled = true;
    };
  }, [backend, capabilities.templates]);

  // Load default view on startup
  const defaultViewLoadedRef = useRef(false);
  useEffect(() => {
    if (defaultViewLoadedRef.current) return;
    if (!defaultView) return;
    const view = savedViews.find((v) => v.name === defaultView);
    if (view) {
      defaultViewLoadedRef.current = true;
      filterStore.getState().loadView(view as SavedView);
      if (view.sort) {
        listViewStore.getState().setSortStack(view.sort as SortEntry[]);
      }
    }
  }, [savedViews, defaultView]);

  const queue = useBackendDataStore((s) => s.queue);

  const queueWrite = async (action: QueueAction, itemId: string) => {
    if (queue) {
      await queue.append({
        action,
        itemId,
        timestamp: new Date().toISOString(),
      });
      syncManager?.pushPending().catch((err: unknown) => {
        uiStore
          .getState()
          .setToast(err instanceof Error ? err.message : 'Sync failed');
      });
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
    if (
      types.length > 0 &&
      (activeType === null || !types.includes(activeType))
    ) {
      setActiveType(
        defaultType && types.includes(defaultType) ? defaultType : types[0]!,
      );
    }
  }, [activeType, types, setActiveType, defaultType]);

  // Apply view filters to all items (used for children in tree view)
  const viewFilteredItems = useMemo(
    () => applyFilters(allItems, activeFilters),
    [allItems, activeFilters],
  );
  const unfilteredCount = useMemo(
    () => allItems.filter((item) => item.type === activeType).length,
    [allItems, activeType],
  );
  const items = useMemo(() => {
    const hasTypeFilter = (activeFilters.types?.length ?? 0) > 0;
    let filtered = hasTypeFilter
      ? allItems
      : allItems.filter((item) => item.type === activeType);
    filtered = applyFilters(filtered, activeFilters);
    return filtered;
  }, [allItems, activeType, activeFilters]);
  const fullTree = useMemo(() => {
    const tree = capabilities.relationships
      ? buildTree(items, viewFilteredItems, activeType ?? '')
      : buildTree(items, items, activeType ?? '');
    return sortTree(tree, sortStack);
  }, [
    items,
    viewFilteredItems,
    activeType,
    capabilities.relationships,
    sortStack,
  ]);

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
    setRangeAnchor(null);
  }, [treeItems.length, clampCursor, setRangeAnchor]);

  useEffect(() => {
    setShowFullDescription(false);
    setDescriptionScrollOffset(0);
  }, [cursor]);

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

  const markedDistribution = useMemo(
    () =>
      getMarkedDistribution(
        markedIds,
        treeItems.map((t) => t.item),
        viewport.start,
        viewport.end,
      ),
    [markedIds, treeItems, viewport.start, viewport.end],
  );

  // Block 1.5: Description scroll handler — active when full description is shown
  useInput(
    (_input, key) => {
      if (
        matchesCommand('list-toggle-description', _input, key) ||
        key.escape
      ) {
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
      if (matchesCommand('list-command-bar', input, key)) {
        openOverlay({ type: 'command-bar' });
        return;
      }

      if (matchesCommand('help', input, key)) {
        navigateToHelp();
        return;
      }

      if (matchesCommand('list-range-select', input, key)) {
        const anchor = rangeAnchor ?? cursor;
        if (rangeAnchor === null) setRangeAnchor(cursor);
        const newCursor = key.upArrow
          ? Math.max(0, cursor - 1)
          : Math.min(treeItems.length - 1, cursor + 1);
        setCursor(newCursor);
        const start = Math.min(anchor, newCursor);
        const end = Math.max(anchor, newCursor);
        setMarkedIds(
          new Set(treeItems.slice(start, end + 1).map((t) => t.item.id)),
        );
        clearWarning();
      }
      if (matchesCommand('list-navigate', input, key)) {
        if (rangeAnchor !== null) setRangeAnchor(null);
        if (key.upArrow) {
          setCursor(Math.max(0, cursor - 1));
        } else {
          setCursor(Math.min(treeItems.length - 1, cursor + 1));
        }
        clearWarning();
      }
      if (matchesCommand('list-page', input, key)) {
        if (key.pageUp) {
          setCursor(Math.max(0, cursor - viewport.maxVisible));
        } else {
          setCursor(
            Math.min(treeItems.length - 1, cursor + viewport.maxVisible),
          );
        }
        clearWarning();
      }
      if (matchesCommand('list-home-end', input, key)) {
        if (key.home) {
          setCursor(0);
        } else {
          setCursor(treeItems.length - 1);
        }
        clearWarning();
      }

      if (matchesCommand('list-expand', input, key) && treeItems.length > 0) {
        const current = treeItems[cursor];
        if (
          current &&
          current.hasChildren &&
          collapsedIds.has(current.item.id)
        ) {
          toggleExpanded(current.item.id);
        }
      }

      if (matchesCommand('list-collapse', input, key) && treeItems.length > 0) {
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

      if (matchesCommand('edit', input, key) && treeItems.length > 0) {
        setFormMode('item');
        selectWorkItem(treeItems[cursor]!.item.id);
        navigate('form');
      }

      if (matchesCommand('quit', input, key)) exit();
      if (matchesCommand('iterations', input, key) && capabilities.iterations)
        navigate('iteration-picker');
      if (matchesCommand('list-pr-list', input, key)) {
        navigate('pr-list');
        return;
      }
      if (matchesCommand('list-branch-manage', input, key) && gitAvailable) {
        navigate('branch-list');
        return;
      }
      if (matchesCommand('settings', input, key)) {
        if (updateInfo?.updateAvailable) {
          setSettingsInitialFocus('update-now');
        }
        navigate('settings');
      }

      if (matchesCommand('create', input, key)) {
        if (capabilities.templates && templates.length > 0) {
          openOverlay({ type: 'template-picker' });
        } else {
          setFormMode('item');
          setActiveTemplate(null);
          selectWorkItem(null);
          navigate('form');
        }
      }

      if (matchesCommand('delete', input, key) && treeItems.length > 0) {
        const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
        if (targetIds.length > 0) {
          openOverlay({ type: 'delete-confirm', targetIds });
        }
      }

      if (matchesCommand('list-undo', input, key)) {
        const entry = undoStore.getState().popUndo();
        if (!entry || !backend) return;
        void (async () => {
          if (entry.type === 'delete') {
            if (isSoftDeleteBackend(backend)) {
              for (const snap of entry.itemSnapshots) {
                await backend.restoreWorkItem(snap.id);
              }
            }
            if (queue) {
              await queue.removeByIds(entry.syncItemIds, 'delete');
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
            if (queue) {
              await queue.removeByIds(entry.syncItemIds, 'create');
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
            if (queue) {
              await queue.removeByIds(entry.syncItemIds, 'update');
            }
            for (const snap of entry.itemSnapshots) {
              await queueWrite('update', snap.id);
            }
            refreshData();
            setToast(`Undid ${entry.label}`);
          }
        })().catch((err: unknown) => {
          uiStore
            .getState()
            .setToast(err instanceof Error ? err.message : 'Undo failed');
        });
      }

      if (
        matchesCommand('open', input, key) &&
        treeItems.length > 0 &&
        backend
      ) {
        void (async () => {
          const itemId = treeItems[cursor]!.item.id;
          await backend.openItem(itemId);
          void backendDataStore
            .getState()
            .reloadItem(itemId)
            .catch(() => {});
        })().catch(() => {});
      }

      if (
        matchesCommand('branch', input, key) &&
        gitAvailable &&
        treeItems.length > 0
      ) {
        const item = treeItems[cursor]!.item;
        const comments = item.comments;
        try {
          const itemUrl = backend?.getItemUrl(item.id) || '';
          // Suspend terminal for interactive child process
          process.stdin.setRawMode?.(false);
          const result = beginImplementation(
            item,
            comments,
            { branchMode, branchCommand, copyToClipboard },
            process.cwd(),
            { itemUrl },
          );
          // Restore terminal after interactive shell
          process.stdin.setRawMode?.(true);
          console.clear();
          let msg = result.resumed
            ? `Resumed work on #${item.id}`
            : `Started work on #${item.id}`;
          if (result.commandFailed) {
            msg += ' (branch command failed, fell back to shell)';
          }
          setWarning(msg);
        } catch (e) {
          process.stdin.setRawMode?.(true);
          console.clear();
          setWarning(
            e instanceof Error ? e.message : 'Failed to start implementation',
          );
        }
        void backendDataStore
          .getState()
          .reloadItem(item.id)
          .catch(() => {});
      }

      if (matchesCommand('status', input, key)) {
        navigate('status');
      }

      if (matchesCommand('sort', input, key)) {
        openOverlay({ type: 'sort-picker' });
      }

      if (matchesCommand('filter', input, key)) {
        openOverlay({ type: 'filter-picker' });
      }

      if (matchesCommand('load-view', input, key)) {
        openOverlay({ type: 'view-picker' });
      }

      if (matchesCommand('clear-filters', input, key) && filterCount > 0) {
        filterStore.getState().clearFilters();
        setToast('Filters cleared');
      }

      if (matchesCommand('list-status', input, key) && treeItems.length > 0) {
        const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
        if (targetIds.length > 0) {
          openOverlay({ type: 'status-picker', targetIds });
        }
      }

      if (matchesCommand('toggle-detail-panel', input, key)) {
        void configStore
          .getState()
          .update({ showDetailPanel: !showDetailPanel })
          .catch(() => {});
      }

      if (
        matchesCommand('list-toggle-description', input, key) &&
        showDetailPanel &&
        hasDescription
      ) {
        setShowFullDescription(true);
        setDescriptionScrollOffset(0);
      }

      if (
        matchesCommand('list-pr-create', input, key) &&
        prCapabilities.create &&
        treeItems.length > 0
      ) {
        const item = treeItems[cursor]?.item;
        if (item) {
          const cwd = process.cwd();
          const currentBranch = getCurrentBranch(cwd);
          const expectedBranch = `tic/${slugify(item.id, item.title)}`;
          const sourceBranch = currentBranch ?? expectedBranch;
          void backendDataStore
            .getState()
            .createPullRequest({
              title: item.title,
              sourceBranch,
              linkedItems: [item.id],
            })
            .then((pr) => {
              setToast(`PR #${String(pr.number)} created`);
            })
            .catch((err: unknown) => {
              setWarning(
                err instanceof Error ? err.message : 'Failed to create PR',
              );
            });
        }
      }

      if (
        matchesCommand('list-tab', input, key) &&
        capabilities.customTypes &&
        types.length > 0
      ) {
        const currentIdx = types.indexOf(activeType ?? '');
        const nextType = types[(currentIdx + 1) % types.length]!;
        setActiveType(nextType);
        setCursor(0);
        clearWarning();
      }

      if (matchesCommand('sync', input, key) && syncManager) {
        void syncManager
          .sync()
          .then(() => {
            refreshData();
          })
          .catch(() => {
            // Errors recorded in syncStatus by SyncManager
          });
      }

      if (matchesCommand('mark', input, key) && treeItems.length > 0) {
        setRangeAnchor(null);
        const itemId = treeItems[cursor]!.item.id;
        toggleMarked(itemId);
      }

      if (matchesCommand('clear-marks', input, key) && treeItems.length > 0) {
        setRangeAnchor(null);
        const visibleIds = treeItems.map((t) => t.item.id);
        const allMarked = visibleIds.every((id) => markedIds.has(id));
        if (allMarked) {
          clearMarked();
        } else {
          setMarkedIds(new Set(visibleIds));
        }
      }

      if (matchesCommand('bulk-menu', input, key) && treeItems.length > 0) {
        openOverlay({ type: 'bulk-menu' });
      }

      if (
        matchesCommand('set-priority', input, key) &&
        capabilities.fields.priority &&
        treeItems.length > 0
      ) {
        const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
        if (targetIds.length > 0) {
          openOverlay({ type: 'priority-picker', targetIds });
        }
      }

      if (
        matchesCommand('list-parent', input, key) &&
        capabilities.fields.parent &&
        treeItems.length > 0
      ) {
        const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
        if (targetIds.length > 0) {
          openOverlay({ type: 'parent-input', targetIds });
        }
      }

      if (
        matchesCommand('set-assignee', input, key) &&
        capabilities.fields.assignee &&
        treeItems.length > 0
      ) {
        const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
        if (targetIds.length > 0) {
          openOverlay({ type: 'assignee-input', targetIds });
        }
      }

      if (
        matchesCommand('set-labels', input, key) &&
        capabilities.fields.labels &&
        treeItems.length > 0
      ) {
        const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
        if (targetIds.length > 0) {
          openOverlay({ type: 'labels-input', targetIds });
        }
      }

      if (
        matchesCommand('set-type', input, key) &&
        capabilities.customTypes &&
        treeItems.length > 0
      ) {
        const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
        if (targetIds.length > 0) {
          openOverlay({ type: 'type-picker', targetIds });
        }
      }
    },
    { isActive: activeOverlay === null && !showFullDescription },
  );

  const commandContext: CommandContext = {
    screen: 'list',
    markedCount: markedIds.size,
    hasSelectedItem: treeItems.length > 0 && treeItems[cursor] !== undefined,
    capabilities,
    types,
    activeType,
    hasSyncManager: syncManager !== null,
    gitAvailable,
    hasActiveFilters: filterCount > 0,
    hasSavedViews: savedViews.length > 0,
    hasSelectedBranch: false,
    isCurrentBranch: false,
    hasWorktree: false,
    hasPrCreateCapability: false,
    hasSelectedPr: false,
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

  const sortPickerItems: OverlayItem[] = useMemo(() => {
    const columns: { column: SortColumn; label: string }[] = [
      { column: 'id', label: 'ID' },
      { column: 'title', label: 'Title' },
      { column: 'status', label: 'Status' },
      { column: 'priority', label: 'Priority' },
      { column: 'assignee', label: 'Assignee' },
      { column: 'created', label: 'Created' },
      { column: 'updated', label: 'Updated' },
    ];

    const items: OverlayItem[] = [];

    if (sortStack.length > 0) {
      items.push({ id: '__clear__', label: 'Clear sort', value: '__clear__' });
    }

    for (const col of columns) {
      if (col.column === 'priority' && !capabilities.fields.priority) continue;
      if (col.column === 'assignee' && !capabilities.fields.assignee) continue;

      const idx = sortStack.findIndex((e) => e.column === col.column);
      let label = col.label;
      if (idx !== -1) {
        const entry = sortStack[idx]!;
        const arrow = entry.direction === 'asc' ? '\u25B2' : '\u25BC';
        const pos = sortStack.length > 1 ? `${idx + 1} ` : '';
        label = `${pos}${col.label} ${arrow}`;
      }

      items.push({ id: col.column, label, value: col.column });
    }

    return items;
  }, [sortStack, capabilities.fields.priority, capabilities.fields.assignee]);

  const filterPickerItems: OverlayItem[] = useMemo(() => {
    const items: OverlayItem[] = [];

    if (filterCount > 0) {
      items.push({
        id: '__clear__',
        label: 'Clear all filters',
        value: '__clear__',
      });
    }

    for (const s of statuses) {
      items.push({
        id: `status-${s}`,
        label: s,
        value: s,
        category: 'Status',
        selected: activeFilters.statuses?.includes(s),
      });
    }

    for (const p of ['critical', 'high', 'medium', 'low']) {
      if (!capabilities.fields.priority) continue;
      items.push({
        id: `priority-${p}`,
        label: p.charAt(0).toUpperCase() + p.slice(1),
        value: p,
        category: 'Priority',
        selected: activeFilters.priorities?.includes(p),
      });
    }

    for (const t of types) {
      items.push({
        id: `type-${t}`,
        label: t.charAt(0).toUpperCase() + t.slice(1),
        value: t,
        category: 'Type',
        selected: activeFilters.types?.includes(t),
      });
    }

    for (const a of assignees) {
      if (!capabilities.fields.assignee) continue;
      items.push({
        id: `assignee-${a}`,
        label: a,
        value: a,
        category: 'Assignee',
        selected: activeFilters.assignees?.includes(a),
      });
    }

    for (const l of labelSuggestions) {
      if (!capabilities.fields.labels) continue;
      items.push({
        id: `label-${l}`,
        label: l,
        value: l,
        category: 'Labels',
        selected: activeFilters.labels?.includes(l),
      });
    }

    return items;
  }, [
    statuses,
    types,
    assignees,
    labelSuggestions,
    capabilities,
    activeFilters,
    filterCount,
  ]);

  const viewPickerItems: OverlayItem[] = useMemo(() => {
    const noFilterLabel = !defaultView ? 'No filters (default)' : 'No filters';
    const items: OverlayItem[] = [
      {
        id: '__no-filters__',
        label: noFilterLabel,
        value: '__no-filters__',
        hint: !activeViewName && filterCount === 0 ? '●' : '',
      },
      ...savedViews.map((v) => ({
        id: v.name,
        label: v.name + (v.name === defaultView ? ' (default)' : ''),
        value: v.name,
        hint:
          summarizeFilters(v.filters) + (v.name === activeViewName ? ' ●' : ''),
      })),
    ];
    if (filterCount > 0) {
      if (lastViewName) {
        items.push({
          id: '__save__',
          label: `Save to "${lastViewName}"`,
          value: '__save__',
          category: 'Actions',
        });
      }
      items.push({
        id: '__new__',
        label: 'New view',
        value: '__new__',
        category: 'Actions',
      });
    }
    return items;
  }, [savedViews, defaultView, activeViewName, lastViewName, filterCount]);

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
            const itemId = treeItems[cursor]!.item.id;
            await backend.openItem(itemId);
            void backendDataStore
              .getState()
              .reloadItem(itemId)
              .catch(() => {});
          })().catch(() => {});
        }
        break;
      case 'branch':
        if (treeItems[cursor]) {
          const item = treeItems[cursor].item;
          const comments = item.comments;
          try {
            const itemUrl = backend?.getItemUrl(item.id) || '';
            process.stdin.setRawMode?.(false);
            const result = beginImplementation(
              item,
              comments,
              { branchMode, branchCommand, copyToClipboard },
              process.cwd(),
              { itemUrl },
            );
            process.stdin.setRawMode?.(true);
            console.clear();
            let msg = result.resumed
              ? `Resumed work on #${item.id}`
              : `Started work on #${item.id}`;
            if (result.commandFailed) {
              msg += ' (branch command failed, fell back to shell)';
            }
            setWarning(msg);
          } catch (e) {
            process.stdin.setRawMode?.(true);
            console.clear();
            setWarning(
              e instanceof Error ? e.message : 'Failed to start implementation',
            );
          }
          void backendDataStore
            .getState()
            .reloadItem(item.id)
            .catch(() => {});
        }
        break;
      case 'sync':
        if (syncManager) {
          void syncManager
            .sync()
            .then(() => refreshData())
            .catch(() => {
              // Errors recorded in syncStatus by SyncManager
            });
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
      case 'sort':
        openOverlay({ type: 'sort-picker' });
        break;
      case 'filter':
        openOverlay({ type: 'filter-picker' });
        break;
      case 'clear-filters':
        filterStore.getState().clearFilters();
        setToast('Filters cleared');
        break;
      case 'load-view':
        openOverlay({ type: 'view-picker' });
        break;
      case 'save-view':
        openOverlay({ type: 'save-view-input' });
        break;
      case 'delete-view':
        openOverlay({ type: 'delete-view-picker' });
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

  const workItemColumns = useMemo(() => {
    const maxIdLen = visibleTreeItems.reduce(
      (max, { item }) => Math.max(max, item.id.length),
      2,
    );
    const cols = buildWorkItemColumns(capabilities, collapsedIds, accent);
    cols[0]!.width = maxIdLen + 2;
    return cols;
  }, [visibleTreeItems, capabilities, collapsedIds, accent]);

  const positionText =
    treeItems.length > viewport.maxVisible
      ? `${cursor + 1}/${treeItems.length}`
      : '';

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text wrap="truncate">
          <Text bold color={accent}>
            {typeLabel} — {iteration}
          </Text>
          <Text
            dimColor={mutedDim}
          >{` (${filterCount > 0 ? `${items.length}/${unfilteredCount}` : items.length} item${unfilteredCount === 1 ? '' : 's'})`}</Text>
          {markedCount > 0 && (
            <Text color={marked}>
              {` ● ${markedCount}`}
              {markedDistribution.above > 0 && ` ↑${markedDistribution.above}`}
              {markedDistribution.below > 0 && ` ↓${markedDistribution.below}`}
            </Text>
          )}
          {filterCount > 0 && (
            <Text color={warningColor}>
              {` [${filterCount} filter${filterCount === 1 ? '' : 's'}${activeViewName ? `: ${activeViewName}` : ''}]`}
            </Text>
          )}
        </Text>
      </Box>

      <TableLayout
        items={visibleTreeItems}
        columns={workItemColumns}
        cursor={viewport.visibleCursor}
        terminalWidth={terminalWidth}
        getKey={(ti) => `${ti.item.id}-${ti.item.type}`}
        isMarked={(ti) => markedIds.has(ti.item.id)}
        sortStack={sortStack}
      />

      {treeItems.length === 0 && !loading && initError && (
        <Box marginTop={1} flexDirection="column">
          <Text color={errorColor}>Failed to connect to backend:</Text>
          <Box marginLeft={2}>
            <Text color={errorColor}>{initError}</Text>
          </Box>
          <Text dimColor={mutedDim}>Press , for settings or q to quit.</Text>
        </Box>
      )}
      {treeItems.length === 0 && !loading && !initError && (
        <Box marginTop={1}>
          <Text dimColor={mutedDim}>
            No {activeType ?? 'item'}s in this iteration. Press c to create, /
            to search all.
          </Text>
        </Box>
      )}
      {loading && treeItems.length === 0 && (
        <Box marginTop={1}>
          <Text dimColor={mutedDim}>Loading...</Text>
        </Box>
      )}

      {showDetailPanel && treeItems.length > 0 && treeItems[cursor] && (
        <Box marginTop={1}>
          <DetailPanel
            item={treeItems[cursor].item}
            terminalWidth={terminalWidth}
            showFullDescription={showFullDescription}
            descriptionScrollOffset={descriptionScrollOffset}
            maxDescriptionHeight={maxDescriptionHeight}
          />
        </Box>
      )}

      <Box marginTop={1}>
        {showFullDescription ? (
          <Box>
            <Text dimColor={mutedDim}>↑↓ scroll space/esc close</Text>
            {positionText && <Text dimColor={mutedDim}> {positionText}</Text>}
          </Box>
        ) : activeOverlay?.type === 'command-bar' ? (
          <CommandBar
            commands={paletteCommands}
            onCommand={handleCommandSelect}
            onCancel={closeOverlay}
          />
        ) : activeOverlay?.type === 'bulk-menu' ? (
          (() => {
            const bulkItems: OverlayItem[] = [];
            bulkItems.push({
              id: 'status',
              label: 'Set status',
              value: 'status',
              hint: 's',
            });
            if (capabilities.iterations) {
              bulkItems.push({
                id: 'iteration',
                label: 'Set iteration',
                value: 'iteration',
                hint: 'i',
              });
            }
            if (capabilities.fields.parent) {
              bulkItems.push({
                id: 'parent',
                label: 'Set parent',
                value: 'parent',
                hint: 'g',
              });
            }
            if (capabilities.customTypes) {
              bulkItems.push({
                id: 'type',
                label: 'Set type',
                value: 'type',
                hint: 't',
              });
            }
            if (capabilities.fields.priority) {
              bulkItems.push({
                id: 'priority',
                label: 'Set priority',
                value: 'priority',
                hint: 'y',
              });
            }
            if (capabilities.fields.assignee) {
              bulkItems.push({
                id: 'assignee',
                label: 'Set assignee',
                value: 'assignee',
                hint: 'a',
              });
            }
            if (capabilities.fields.labels) {
              bulkItems.push({
                id: 'labels',
                label: 'Set labels',
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
        ) : activeOverlay?.type === 'status-picker' ? (
          <OverlayPanel
            title="Set Status"
            fieldType="status"
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
                for (const id of targetIds) {
                  await backendDataStore.getState().reloadItem(id);
                }
                setToast(
                  targetIds.length === 1
                    ? 'Status updated — press u to undo'
                    : `${targetIds.length} items updated — press u to undo`,
                );
              })().catch((err: unknown) => {
                uiStore
                  .getState()
                  .setToast(
                    err instanceof Error ? err.message : 'Update failed',
                  );
              });
            }}
            onCancel={() => closeOverlay()}
          />
        ) : activeOverlay?.type === 'type-picker' ? (
          <OverlayPanel
            title="Set Type"
            fieldType="type"
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
                for (const id of targetIds) {
                  await backendDataStore.getState().reloadItem(id);
                }
                setToast(
                  targetIds.length === 1
                    ? 'Type updated — press u to undo'
                    : `${targetIds.length} items updated — press u to undo`,
                );
              })().catch((err: unknown) => {
                uiStore
                  .getState()
                  .setToast(
                    err instanceof Error ? err.message : 'Update failed',
                  );
              });
            }}
            onCancel={() => closeOverlay()}
          />
        ) : activeOverlay?.type === 'priority-picker' ? (
          <OverlayPanel
            title="Set Priority"
            fieldType="priority"
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
                for (const id of targetIds) {
                  await backendDataStore.getState().reloadItem(id);
                }
                setToast(
                  targetIds.length === 1
                    ? 'Priority updated — press u to undo'
                    : `${targetIds.length} items updated — press u to undo`,
                );
              })().catch((err: unknown) => {
                uiStore
                  .getState()
                  .setToast(
                    err instanceof Error ? err.message : 'Update failed',
                  );
              });
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
                for (const id of targetIds) {
                  await backendDataStore.getState().reloadItem(id);
                }
                setToast(
                  targetIds.length === 1
                    ? 'Parent updated — press u to undo'
                    : `${targetIds.length} items updated — press u to undo`,
                );
              })().catch(() => {});
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
                for (const id of targetIds) {
                  await backendDataStore.getState().reloadItem(id);
                }
                setToast(
                  targetIds.length === 1
                    ? 'Parent updated — press u to undo'
                    : `${targetIds.length} items updated — press u to undo`,
                );
              })().catch(() => {});
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
                for (const id of targetIds) {
                  await backendDataStore.getState().reloadItem(id);
                }
                setToast(
                  targetIds.length === 1
                    ? 'Assignee updated — press u to undo'
                    : `${targetIds.length} items updated — press u to undo`,
                );
              })().catch((err: unknown) => {
                uiStore
                  .getState()
                  .setToast(
                    err instanceof Error ? err.message : 'Update failed',
                  );
              });
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
                for (const id of targetIds) {
                  await backendDataStore.getState().reloadItem(id);
                }
                setToast(
                  targetIds.length === 1
                    ? 'Assignee updated — press u to undo'
                    : `${targetIds.length} items updated — press u to undo`,
                );
              })().catch((err: unknown) => {
                uiStore
                  .getState()
                  .setToast(
                    err instanceof Error ? err.message : 'Update failed',
                  );
              });
            }}
            onCancel={() => closeOverlay()}
            placeholder="Type assignee name..."
          />
        ) : activeOverlay?.type === 'labels-input' ? (
          <OverlayPanel
            title={`Set Labels (${activeOverlay.targetIds.length} item${activeOverlay.targetIds.length > 1 ? 's' : ''})`}
            fieldType="label"
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
                for (const id of targetIds) {
                  await backendDataStore.getState().reloadItem(id);
                }
                setToast(
                  targetIds.length === 1
                    ? 'Labels updated — press u to undo'
                    : `${targetIds.length} items updated — press u to undo`,
                );
              })().catch((err: unknown) => {
                uiStore
                  .getState()
                  .setToast(
                    err instanceof Error ? err.message : 'Update failed',
                  );
              });
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
                for (const id of targetIds) {
                  await backendDataStore.getState().reloadItem(id);
                }
                setToast(
                  targetIds.length === 1
                    ? 'Labels updated — press u to undo'
                    : `${targetIds.length} items updated — press u to undo`,
                );
              })().catch((err: unknown) => {
                uiStore
                  .getState()
                  .setToast(
                    err instanceof Error ? err.message : 'Update failed',
                  );
              });
            }}
            onCancel={() => closeOverlay()}
            placeholder="Type to filter labels..."
          />
        ) : activeOverlay?.type === 'sort-picker' ? (
          <OverlayPanel
            title="Order by"
            items={sortPickerItems}
            onSelect={(item) => {
              closeOverlay();
              if (item.value === '__clear__') {
                clearSort();
              } else {
                toggleSortColumn(item.value as SortColumn);
              }
            }}
            onCancel={() => closeOverlay()}
          />
        ) : activeOverlay?.type === 'filter-picker' ? (
          (() => {
            const handleFilterConfirm = (selected: OverlayItem[]) => {
              const newFilters: ViewFilters = {};
              for (const item of selected) {
                const cat = item.category;
                if (cat === 'Status') {
                  (newFilters.statuses ??= []).push(item.value);
                } else if (cat === 'Priority') {
                  (newFilters.priorities ??= []).push(item.value);
                } else if (cat === 'Type') {
                  (newFilters.types ??= []).push(item.value);
                } else if (cat === 'Assignee') {
                  (newFilters.assignees ??= []).push(item.value);
                } else if (cat === 'Labels') {
                  (newFilters.labels ??= []).push(item.value);
                }
              }
              filterStore.getState().setFilters(newFilters);
              closeOverlay();
              const count = countActiveFilters(newFilters);
              if (count > 0) {
                setToast(`${count} filter${count === 1 ? '' : 's'} applied`);
              } else {
                setToast('Filters cleared');
              }
            };

            const handleFilterSelect = (item: OverlayItem) => {
              if (item.value === '__clear__') {
                filterStore.getState().clearFilters();
                closeOverlay();
                setToast('Filters cleared');
              }
            };

            return (
              <OverlayPanel
                title={
                  filterCount > 0 ? `Filter [${filterCount} active]` : 'Filter'
                }
                items={filterPickerItems}
                multiSelect
                onSelect={handleFilterSelect}
                onConfirm={handleFilterConfirm}
                onCancel={() => closeOverlay()}
                placeholder="Type to filter..."
                footer="space toggle  enter confirm  esc cancel"
              />
            );
          })()
        ) : activeOverlay?.type === 'view-picker' ? (
          <OverlayPanel
            title="Load View"
            items={viewPickerItems}
            onSelect={(item) => {
              if (item.value === '__no-filters__') {
                filterStore.getState().clearFilters();
                listViewStore.getState().setSortStack([]);
                closeOverlay();
                setToast('Filters cleared');
                return;
              }
              if (item.value === '__save__' && lastViewName) {
                const newView = {
                  name: lastViewName,
                  filters: { ...activeFilters },
                  ...(sortStack.length > 0 ? { sort: [...sortStack] } : {}),
                };
                const existing = savedViews.filter(
                  (v) => v.name !== lastViewName,
                );
                void configStore
                  .getState()
                  .update({
                    views: [...existing, newView],
                  })
                  .catch(() => {});
                filterStore.setState({
                  activeViewName: lastViewName,
                });
                closeOverlay();
                setToast(`View "${lastViewName}" saved`);
                return;
              }
              if (item.value === '__new__') {
                openOverlay({ type: 'save-view-input' });
                return;
              }
              const view = savedViews.find((v) => v.name === item.value);
              if (view) {
                filterStore.getState().loadView(view as SavedView);
                if (view.sort) {
                  listViewStore
                    .getState()
                    .setSortStack(view.sort as SortEntry[]);
                }
                closeOverlay();
                setToast(`View "${view.name}" loaded`);
              }
            }}
            onAction={(item) => {
              if (
                item.value === '__no-filters__' ||
                item.value === defaultView
              ) {
                void configStore
                  .getState()
                  .update({ defaultView: undefined })
                  .catch(() => {});
                setToast('Default view cleared');
              } else {
                void configStore
                  .getState()
                  .update({ defaultView: item.value })
                  .catch(() => {});
                setToast(`View "${item.value}" set as default`);
              }
            }}
            onCancel={() => closeOverlay()}
            footer="↑↓ navigate  enter load  tab set default  esc cancel"
          />
        ) : activeOverlay?.type === 'save-view-input' ? (
          <OverlayPanel
            title="Save View"
            items={[]}
            allowFreeform
            onSelect={() => {}}
            onSubmitFreeform={(name) => {
              if (!name.trim()) {
                closeOverlay();
                return;
              }
              const newView = {
                name: name.trim(),
                filters: { ...activeFilters },
                ...(sortStack.length > 0 ? { sort: [...sortStack] } : {}),
              };
              const existing = savedViews.filter((v) => v.name !== name.trim());
              void configStore
                .getState()
                .update({
                  views: [...existing, newView],
                })
                .catch(() => {});
              filterStore.setState({ activeViewName: name.trim() });
              closeOverlay();
              setToast(`View "${name.trim()}" saved`);
            }}
            onCancel={() => closeOverlay()}
            placeholder="Enter view name..."
            emptyMessage="Type a name and press enter"
          />
        ) : activeOverlay?.type === 'delete-view-picker' ? (
          <OverlayPanel
            title="Delete View"
            items={viewPickerItems.filter((i) => i.id !== '__no-filters__')}
            onSelect={(item) => {
              const remaining = savedViews.filter((v) => v.name !== item.value);
              void configStore
                .getState()
                .update({
                  views: remaining,
                  ...(defaultView === item.value
                    ? { defaultView: undefined }
                    : {}),
                })
                .catch(() => {});
              if (activeViewName === item.value) {
                filterStore.setState({ activeViewName: null });
              }
              closeOverlay();
              setToast(`View "${item.value}" deleted`);
            }}
            onCancel={() => closeOverlay()}
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
                  if (softDelete) {
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
                    if (evicted?.type === 'delete') {
                      for (const snap of evicted.itemSnapshots) {
                        await backend.permanentlyDeleteWorkItem(snap.id);
                      }
                    }
                  }
                  closeOverlay();
                  for (const id of targetIds) {
                    removeDeletedItem(id);
                  }
                  setCursor(Math.max(0, cursor - 1));
                  for (const id of targetIds) {
                    backendDataStore.getState().removeItem(id);
                  }
                  setToast(
                    targetIds.length === 1
                      ? `Item #${targetIds[0]} deleted${softDelete ? ' — press u to undo' : ''}`
                      : `${targetIds.length} items deleted${softDelete ? ' — press u to undo' : ''}`,
                  );
                })().catch((err: unknown) => {
                  uiStore
                    .getState()
                    .setToast(
                      err instanceof Error ? err.message : 'Delete failed',
                    );
                });
              } else {
                closeOverlay();
              }
            }}
            onCancel={() => closeOverlay()}
          />
        ) : toast ? (
          <Box>
            <Text color={success}>{toast.message}</Text>
            {positionText && <Text dimColor={mutedDim}> {positionText}</Text>}
          </Box>
        ) : (
          <Box>
            <Text dimColor={mutedDim}>
              {buildFooterHints(
                'list',
                commandContext,
                terminalWidth - (positionText ? positionText.length + 2 : 0),
              )}
            </Text>
            {positionText && <Text dimColor={mutedDim}> {positionText}</Text>}
          </Box>
        )}
      </Box>
      {warning && (
        <Box>
          <Text color={warningColor}>⚠ {warning}</Text>
        </Box>
      )}
      {updateInfo?.updateAvailable && activeOverlay === null && (
        <Box>
          <Text color={warningColor}>
            Update available: {updateInfo.current} → {updateInfo.latest} Press ,
            to update in Settings
          </Text>
        </Box>
      )}
    </Box>
  );
}
