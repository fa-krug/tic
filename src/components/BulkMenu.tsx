import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import type { BackendCapabilities } from '../backends/types.js';

export type BulkAction =
  | 'status'
  | 'iteration'
  | 'parent'
  | 'type'
  | 'priority'
  | 'assignee'
  | 'labels'
  | 'delete';

interface BulkMenuProps {
  itemCount: number;
  capabilities: BackendCapabilities;
  onSelect: (action: BulkAction) => void;
  onCancel: () => void;
}

export function BulkMenu({
  itemCount,
  capabilities,
  onSelect,
  onCancel,
}: BulkMenuProps) {
  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    // Shortcut keys
    const shortcuts: Record<string, BulkAction> = {
      s: 'status',
      i: 'iteration',
      p: 'parent',
      t: 'type',
      P: 'priority',
      a: 'assignee',
      l: 'labels',
      d: 'delete',
    };
    const action = shortcuts[input];
    if (action) {
      onSelect(action);
    }
  });

  const items: Array<{ label: string; value: BulkAction }> = [];

  items.push({ label: 'Set status...              (s)', value: 'status' });

  if (capabilities.iterations) {
    items.push({ label: 'Set iteration...           (i)', value: 'iteration' });
  }

  if (capabilities.fields.parent) {
    items.push({ label: 'Set parent...              (p)', value: 'parent' });
  }

  if (capabilities.customTypes) {
    items.push({ label: 'Set type...                (t)', value: 'type' });
  }

  if (capabilities.fields.priority) {
    items.push({ label: 'Set priority...            (P)', value: 'priority' });
  }

  if (capabilities.fields.assignee) {
    items.push({ label: 'Set assignee...            (a)', value: 'assignee' });
  }

  if (capabilities.fields.labels) {
    items.push({ label: 'Set labels...              (l)', value: 'labels' });
  }

  items.push({ label: 'Delete                     (d)', value: 'delete' });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
    >
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Bulk Actions ({itemCount} {itemCount === 1 ? 'item' : 'items'})
        </Text>
      </Box>
      <SelectInput items={items} onSelect={(item) => onSelect(item.value)} />
      <Box marginTop={1}>
        <Text dimColor>{'↑↓ navigate  enter select  esc cancel'}</Text>
      </Box>
    </Box>
  );
}
