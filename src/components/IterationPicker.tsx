import { useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import {
  useBackendDataStore,
  backendDataStore,
} from '../stores/backendDataStore.js';
import { navigationStore } from '../stores/navigationStore.js';
import { uiStore } from '../stores/uiStore.js';
import { useThemeStore } from '../stores/themeStore.js';
import {
  formatIterationDates,
  getIterationStatus,
} from '../iteration-utils.js';

export function IterationPicker() {
  const iterations = useBackendDataStore((s) => s.iterations);
  const currentIteration = useBackendDataStore((s) => s.currentIteration);
  const backend = useBackendDataStore((s) => s.backend);
  const { accent, mutedDim } = useThemeStore((s) => s.colors);

  const items = useMemo(() => {
    return iterations.map((it) => {
      const dates = formatIterationDates(it.startDate, it.endDate);
      const status = getIterationStatus(it.startDate, it.endDate);
      const isCurrent = it.name === currentIteration;

      let label = it.name;
      if (dates) label += `  ${dates}`;
      if (status === 'past') label += '  [past]';
      if (status === 'upcoming') label += '  [upcoming]';
      if (isCurrent) label += '  (current)';

      return { label, value: it.name };
    });
  }, [iterations, currentIteration]);

  useInput((_input, key) => {
    if (key.escape) {
      navigationStore.getState().navigate('list');
    }
  });

  const handleSelect = (item: { label: string; value: string }) => {
    if (!backend) return;
    void (async () => {
      await backend.setCurrentIteration(item.value);
      await backendDataStore.getState().refresh();
      navigationStore.getState().navigate('list');
      uiStore.getState().setToast(`Switched to iteration: ${item.value}`);
    })().catch((err: unknown) => {
      uiStore
        .getState()
        .setToast(err instanceof Error ? err.message : 'Switch failed');
    });
  };

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color={accent}>
          Switch Iteration
        </Text>
      </Box>

      {items.length === 0 ? (
        <Text>No iterations configured.</Text>
      ) : (
        <SelectInput items={items} onSelect={handleSelect} />
      )}

      <Box marginTop={1}>
        <Text dimColor={mutedDim}>esc back</Text>
      </Box>
    </Box>
  );
}
