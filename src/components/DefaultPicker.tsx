import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';

interface DefaultPickerProps {
  title: string;
  options: string[];
  onSelect: (value: string) => void;
  onCancel: () => void;
}

export function DefaultPicker({
  title,
  options,
  onSelect,
  onCancel,
}: DefaultPickerProps) {
  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
    }
  });

  const items = options.map((o) => ({
    label: o,
    value: o,
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
          {title}
        </Text>
      </Box>
      {items.length > 0 ? (
        <SelectInput
          items={items}
          onSelect={(item) => {
            if (item) onSelect(item.value);
          }}
        />
      ) : (
        <Text dimColor>(none configured)</Text>
      )}
      <Box marginTop={1}>
        <Text dimColor>{'↑↓ navigate  enter select  esc cancel'}</Text>
      </Box>
    </Box>
  );
}
