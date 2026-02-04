import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import type { Template } from '../types.js';

interface TemplatePickerProps {
  templates: Template[];
  onSelect: (template: Template | null) => void;
  onCancel: () => void;
}

export function TemplatePicker({
  templates,
  onSelect,
  onCancel,
}: TemplatePickerProps) {
  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
    }
  });

  const items = [
    { label: 'No template', value: '__none__' },
    ...templates.map((t) => ({ label: t.name, value: t.slug })),
  ];

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Select Template</Text>
      </Box>
      <SelectInput
        items={items}
        onSelect={(item) => {
          if (item.value === '__none__') {
            onSelect(null);
          } else {
            const template = templates.find((t) => t.slug === item.value);
            onSelect(template ?? null);
          }
        }}
      />
      <Box marginTop={1}>
        <Text dimColor>{'↑↓ navigate  enter select  esc cancel'}</Text>
      </Box>
    </Box>
  );
}
