import { Box, Text } from 'ink';
import { useThemeStore } from '../stores/themeStore.js';
import type { FieldType } from '../stores/themeStore.js';

export function ColorPill({
  field,
  value,
}: {
  field: FieldType;
  value: string;
}) {
  const resolved = useThemeStore((s) => s.resolveFieldColor(field, value));
  if (!resolved) return <Text>{value}</Text>;
  return (
    <Box>
      <Text backgroundColor={resolved.bg} color={resolved.fg}>
        {' '}
        {value}{' '}
      </Text>
    </Box>
  );
}
