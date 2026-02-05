import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';

interface PriorityPickerProps {
  onSelect: (priority: 'low' | 'medium' | 'high' | 'critical') => void;
  onCancel: () => void;
}

const PRIORITIES: Array<{
  label: string;
  value: 'low' | 'medium' | 'high' | 'critical';
}> = [
  { label: 'Critical', value: 'critical' },
  { label: 'High', value: 'high' },
  { label: 'Medium', value: 'medium' },
  { label: 'Low', value: 'low' },
];

export function PriorityPicker({ onSelect, onCancel }: PriorityPickerProps) {
  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
    >
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Set Priority
        </Text>
      </Box>
      <SelectInput
        items={PRIORITIES}
        onSelect={(item) => onSelect(item.value)}
      />
      <Box marginTop={1}>
        <Text dimColor>{'↑↓ navigate  enter select  esc cancel'}</Text>
      </Box>
    </Box>
  );
}
