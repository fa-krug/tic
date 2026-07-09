import { Text } from 'ink';
import { useThemeStore, ensureContrast } from '../stores/themeStore.js';
import type { FieldType } from '../stores/themeStore.js';

export function ColorPill({
  field,
  value,
  selectionBg,
}: {
  field: FieldType;
  value: string;
  /**
   * When set, the pill is rendered on top of a selected row with this
   * background color; the text color is adjusted to keep enough contrast.
   */
  selectionBg?: string;
}) {
  const resolved = useThemeStore((s) =>
    value ? s.resolveFieldColor(field, value) : null,
  );
  if (!resolved) return <Text>{value}</Text>;
  const color = selectionBg
    ? ensureContrast(resolved.bg, selectionBg)
    : resolved.bg;
  return <Text color={color}>{value}</Text>;
}
