import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { useThemeStore } from '../stores/themeStore.js';
import { useNavigationStore } from '../stores/navigationStore.js';
import {
  useBackendDataStore,
  backendDataStore,
} from '../stores/backendDataStore.js';
import { matchesCommand } from '../commands.js';
import {
  formatIterationDates,
  getIterationStatus,
} from '../iteration-utils.js';

export function IterationPicker() {
  const { mutedDim } = useThemeStore((s) => s.colors);
  const backend = useBackendDataStore((s) => s.backend);
  const navigate = useNavigationStore((s) => s.navigate);
  const navigateToHelp = useNavigationStore((s) => s.navigateToHelp);
  const iterations = useBackendDataStore((s) => s.iterations);
  const current = useBackendDataStore((s) => s.currentIteration);

  useInput((input, key) => {
    if (matchesCommand('nav-back', input, key)) {
      navigate('list');
    }
    if (matchesCommand('help', input, key)) {
      navigateToHelp();
    }
  });

  const items = iterations.map((it) => {
    const dates = formatIterationDates(it.startDate, it.endDate);
    const status = getIterationStatus(it.startDate, it.endDate);
    let label = it.name;
    if (dates) label += '  ' + dates;
    if (status) label += ` (${status})`;
    if (it.name === current) label += ' *';
    return { label, value: it.name };
  });

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Switch Iteration</Text>
      </Box>
      <SelectInput
        items={items}
        initialIndex={iterations.findIndex((it) => it.name === current)}
        onSelect={(item) => {
          void (async () => {
            if (!backend) return;
            await backend.setCurrentIteration(item.value);
            await backendDataStore.getState().refresh();
            navigate('list');
          })();
        }}
      />
      <Box marginTop={1}>
        <Text dimColor={mutedDim}>
          {'↑↓ navigate  enter select  esc back  ? help'}
        </Text>
      </Box>
    </Box>
  );
}
