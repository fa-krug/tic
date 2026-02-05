import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';

interface StatusPickerProps {
  statuses: string[];
  onSelect: (status: string) => void;
  onCancel: () => void;
}

export function StatusPicker({
  statuses,
  onSelect,
  onCancel,
}: StatusPickerProps) {
  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
    }
  });

  const items = statuses.map((s) => ({
    label: s,
    value: s,
  }));

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
    >
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Set Status
        </Text>
      </Box>
      <SelectInput items={items} onSelect={(item) => onSelect(item.value)} />
      <Box marginTop={1}>
        <Text dimColor>{'↑↓ navigate  enter select  esc cancel'}</Text>
      </Box>
    </Box>
  );
}
