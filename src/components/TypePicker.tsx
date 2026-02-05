import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';

interface TypePickerProps {
  types: string[];
  onSelect: (type: string) => void;
  onCancel: () => void;
}

export function TypePicker({ types, onSelect, onCancel }: TypePickerProps) {
  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
    }
  });

  const items = types.map((t) => ({
    label: t.charAt(0).toUpperCase() + t.slice(1),
    value: t,
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
          Set Type
        </Text>
      </Box>
      <SelectInput items={items} onSelect={(item) => onSelect(item.value)} />
      <Box marginTop={1}>
        <Text dimColor>{'↑↓ navigate  enter select  esc cancel'}</Text>
      </Box>
    </Box>
  );
}
