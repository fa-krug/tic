import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { useThemeStore } from '../stores/themeStore.js';
import { useNavigationStore } from '../stores/navigationStore.js';
import {
  useBackendDataStore,
  backendDataStore,
} from '../stores/backendDataStore.js';
import { matchesCommand } from '../commands.js';

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

  const items = iterations.map((it) => ({
    label: it === current ? `${it} (current)` : it,
    value: it,
  }));

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Switch Iteration</Text>
      </Box>
      <SelectInput
        items={items}
        initialIndex={iterations.indexOf(current)}
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
