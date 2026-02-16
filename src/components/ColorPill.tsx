import { Text } from 'ink';
import { useThemeStore } from '../stores/themeStore.js';
import type { FieldType } from '../stores/themeStore.js';

export function ColorPill({
  field,
  value,
}: {
  field: FieldType;
  value: string;
}) {
  const resolved = useThemeStore((s) =>
    value ? s.resolveFieldColor(field, value) : null,
  );
  if (!resolved) return <Text>{value}</Text>;
  return <Text color={resolved.bg}>{value}</Text>;
}
