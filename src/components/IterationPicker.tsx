import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { useAppState } from '../app.js';

export function IterationPicker() {
  const { backend, navigate } = useAppState();
  const iterations = backend.getIterations();
  const current = backend.getCurrentIteration();

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
          backend.setCurrentIteration(item.value);
          navigate('list');
        }}
      />
      <Box marginTop={1}>
        <Text dimColor>up/down: navigate enter: select</Text>
      </Box>
    </Box>
  );
}
