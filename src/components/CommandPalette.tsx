import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { type Command, CATEGORIES } from '../commands.js';
import { useScrollViewport } from '../hooks/useScrollViewport.js';

export interface CommandGroup {
  category: string;
  commands: Command[];
}

export function filterCommands(commands: Command[], query: string): Command[] {
  if (query.trim() === '') return commands;
  const q = query.toLowerCase();
  return commands.filter((cmd) => cmd.label.toLowerCase().includes(q));
}

export function groupByCategory(commands: Command[]): CommandGroup[] {
  const groups: CommandGroup[] = [];
  for (const category of CATEGORIES) {
    const cmds = commands.filter((c) => c.category === category);
    if (cmds.length > 0) {
      groups.push({ category, commands: cmds });
    }
  }
  return groups;
}

export interface CommandPaletteProps {
  commands: Command[];
  onSelect: (command: Command) => void;
  onCancel: () => void;
}

export function CommandPalette({
  commands,
  onSelect,
  onCancel,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filtered = filterCommands(commands, query);
  const groups = groupByCategory(filtered);

  // Build flat list of selectable items (skipping category headers)
  const selectableItems: Command[] = groups.flatMap((g) => g.commands);

  // Clamp selectedIndex to valid range
  const clampedIndex = Math.min(
    selectedIndex,
    Math.max(0, selectableItems.length - 1),
  );

  const viewport = useScrollViewport({
    totalItems: selectableItems.length,
    cursor: clampedIndex,
    chromeLines: 4, // input line + margin + empty state/footer + border
    linesPerItem: 1,
  });

  const visibleItems = selectableItems.slice(viewport.start, viewport.end);
  const visibleGroups = groupByCategory(visibleItems);

  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(selectableItems.length - 1, i + 1));
    }
    if (key.return && selectableItems.length > 0) {
      const selected = selectableItems[clampedIndex];
      if (selected) {
        onSelect(selected);
      }
    }
  });

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setSelectedIndex(0);
  };

  // Track which selectable index we're at while rendering
  let selectableIdx = 0;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
    >
      <Box marginBottom={1}>
        <Text dimColor>: </Text>
        <TextInput
          value={query}
          onChange={handleQueryChange}
          focus={true}
          placeholder="Type a command..."
        />
      </Box>

      {selectableItems.length === 0 && query.trim() !== '' && (
        <Text dimColor>No matching commands</Text>
      )}

      {visibleGroups.map((group) => (
        <Box key={group.category} flexDirection="column">
          <Text dimColor bold>
            {group.category}
          </Text>
          {group.commands.map((cmd) => {
            const idx = selectableIdx++;
            const isSelected = idx === viewport.visibleCursor;
            return (
              <Box key={cmd.id}>
                <Text color={isSelected ? 'cyan' : undefined} bold={isSelected}>
                  {isSelected ? '> ' : '  '}
                </Text>
                <Box flexGrow={1}>
                  <Text
                    color={isSelected ? 'cyan' : undefined}
                    bold={isSelected}
                  >
                    {cmd.label}
                  </Text>
                </Box>
                {cmd.shortcut && <Text dimColor> {cmd.shortcut}</Text>}
              </Box>
            );
          })}
        </Box>
      ))}

      <Box marginTop={1}>
        <Text dimColor>{'↑↓ navigate  enter select  esc cancel'}</Text>
      </Box>
    </Box>
  );
}
