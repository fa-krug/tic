import { useState, useMemo, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import {
  useBackendDataStore,
  backendDataStore,
} from '../stores/backendDataStore.js';
import { navigationStore } from '../stores/navigationStore.js';
import { useShallow } from 'zustand/shallow';
import { uiStore } from '../stores/uiStore.js';
import { useThemeStore, autoFg } from '../stores/themeStore.js';
import {
  formatIterationDates,
  getIterationStatus,
} from '../iteration-utils.js';
import { TableLayout } from './TableLayout.js';
import type { ColumnDef } from './TableLayout.js';
import { useTerminalWidth } from '../hooks/useTerminalWidth.js';
import {
  buildFooterHints,
  matchesCommand,
  type CommandContext,
} from '../commands.js';

interface IterationRow {
  name: string;
  dates: string;
  status: 'active' | 'past' | 'upcoming' | null;
  isCurrent: boolean;
}

function statusColor(
  status: 'active' | 'past' | 'upcoming' | null,
): string | undefined {
  switch (status) {
    case 'active':
      return 'green';
    case 'past':
      return 'gray';
    case 'upcoming':
      return 'cyan';
    default:
      return undefined;
  }
}

function statusLabel(status: 'active' | 'past' | 'upcoming' | null): string {
  switch (status) {
    case 'active':
      return 'active';
    case 'past':
      return 'past';
    case 'upcoming':
      return 'upcoming';
    default:
      return '';
  }
}

function buildIterationColumns(
  selectionBg: string,
  accent: string,
): ColumnDef<IterationRow>[] {
  return [
    {
      key: 'name',
      header: 'Iteration',
      width: -1, // flex
      required: true,
      render: (row, selected) => (
        <Text
          color={
            selected ? autoFg(selectionBg) : row.isCurrent ? accent : undefined
          }
          bold={selected || row.isCurrent}
          wrap="truncate"
        >
          {row.isCurrent ? '* ' : '  '}
          {row.name}
        </Text>
      ),
    },
    {
      key: 'dates',
      header: 'Dates',
      width: 22,
      hidePriority: 2,
      hasData: (items) => items.some((i) => i.dates !== ''),
      render: (row, selected) => (
        <Text color={selected ? autoFg(selectionBg) : undefined}>
          {row.dates}
        </Text>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 10,
      hidePriority: 1,
      hasData: (items) => items.some((i) => i.status !== null),
      render: (row, selected) => (
        <Text
          color={selected ? autoFg(selectionBg) : statusColor(row.status)}
          bold={row.status === 'active'}
          dimColor={row.status === 'past' && !selected}
        >
          {statusLabel(row.status)}
        </Text>
      ),
    },
  ];
}

export function IterationPicker() {
  const { iterations, currentIteration, backend, capabilities } =
    useBackendDataStore(
      useShallow((s) => ({
        iterations: s.iterations,
        currentIteration: s.currentIteration,
        backend: s.backend,
        capabilities: s.capabilities,
      })),
    );
  const { accent, muted, mutedDim, selectionBg } = useThemeStore(
    (s) => s.colors,
  );
  const termWidth = useTerminalWidth();

  const rows: IterationRow[] = useMemo(
    () =>
      iterations.map((it) => ({
        name: it.name,
        dates: formatIterationDates(it.startDate, it.endDate) ?? '',
        status: getIterationStatus(it.startDate, it.endDate),
        isCurrent: it.name === currentIteration,
      })),
    [iterations, currentIteration],
  );

  const columns = useMemo(
    () => buildIterationColumns(selectionBg, accent),
    [selectionBg, accent],
  );

  // Start cursor on the current iteration
  const initialCursor = useMemo(() => {
    const idx = rows.findIndex((r) => r.isCurrent);
    return idx >= 0 ? idx : 0;
  }, [rows]);

  const [cursor, setCursor] = useState(initialCursor);

  // Clamp cursor
  const clampedCursor = Math.max(0, Math.min(cursor, rows.length - 1));
  if (clampedCursor !== cursor && rows.length > 0) {
    setCursor(clampedCursor);
  }

  const currentRow = rows[clampedCursor];

  const handleSelect = useCallback(() => {
    if (!backend || !currentRow) return;
    void (async () => {
      await backend.setCurrentIteration(currentRow.name);
      await backendDataStore.getState().refresh();
      navigationStore.getState().navigate('list');
      uiStore.getState().setToast(`Switched to iteration: ${currentRow.name}`);
    })().catch((err: unknown) => {
      uiStore
        .getState()
        .setToast(err instanceof Error ? err.message : 'Switch failed');
    });
  }, [backend, currentRow]);

  const commandContext: CommandContext = {
    screen: 'iteration-picker',
    markedCount: 0,
    hasSelectedItem: false,
    capabilities,
    types: [],
    activeType: null,
    hasSyncManager: false,
    gitAvailable: false,
    hasActiveFilters: false,
    hasSavedViews: false,
    hasSelectedBranch: false,
    isCurrentBranch: false,
    hasWorktree: false,
    hasPrCreateCapability: false,
    hasSelectedPr: false,
    showDetailDescription: false,
  };

  useInput((input, key) => {
    if (matchesCommand('nav-back', input, key)) {
      navigationStore.getState().navigate('list');
      return;
    }

    if (matchesCommand('iteration-navigate', input, key)) {
      if (key.downArrow) {
        setCursor((c) => Math.min(c + 1, rows.length - 1));
      } else {
        setCursor((c) => Math.max(c - 1, 0));
      }
      return;
    }

    if (matchesCommand('iteration-select', input, key)) {
      handleSelect();
      return;
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color={accent}>
          Switch Iteration
        </Text>
        <Text color={muted} dimColor={mutedDim}>
          {' '}
          ({rows.length})
        </Text>
      </Box>

      {rows.length === 0 ? (
        <Text>No iterations configured.</Text>
      ) : (
        <TableLayout
          items={rows}
          columns={columns}
          cursor={clampedCursor}
          terminalWidth={termWidth}
          getKey={(row) => row.name}
        />
      )}

      <Box marginTop={1}>
        <Text color={muted} dimColor={mutedDim}>
          {buildFooterHints('iteration-picker', commandContext, termWidth)}
        </Text>
      </Box>
    </Box>
  );
}
