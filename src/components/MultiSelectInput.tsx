import { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from './TextInput.js';
import { ColorPill } from './ColorPill.js';
import { useThemeStore, autoFg } from '../stores/themeStore.js';

const MAX_VISIBLE = 8;

interface MultiSelectInputProps {
  /** Currently selected values */
  selected: string[];
  /** All available suggestions */
  suggestions: string[];
  /** Called when selection changes */
  onChange: (selected: string[]) => void;
  /** Called when user confirms (Enter with no filter text) */
  onSubmit: () => void;
  /** Called on Escape */
  onCancel: () => void;
  focus: boolean;
}

export function MultiSelectInput({
  selected,
  suggestions,
  onChange,
  onSubmit,
  onCancel,
  focus,
}: MultiSelectInputProps) {
  const { mutedDim, selectionBg } = useThemeStore((s) => s.colors);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  const selectedSet = useMemo(
    () => new Set(selected.map((s) => s.toLowerCase())),
    [selected],
  );

  const filtered = useMemo(() => {
    if (!query) return suggestions;
    const q = query.toLowerCase();
    return suggestions.filter((s) => s.toLowerCase().includes(q));
  }, [suggestions, query]);

  // Clamp cursor
  const clampedCursor = Math.min(cursor, Math.max(0, filtered.length - 1));

  // Viewport for scrolling
  const start = Math.max(
    0,
    Math.min(
      clampedCursor - Math.floor(MAX_VISIBLE / 2),
      filtered.length - MAX_VISIBLE,
    ),
  );
  const visible = filtered.slice(start, start + MAX_VISIBLE);
  const visibleCursor = clampedCursor - start;

  useInput(
    (_input, key) => {
      if (key.escape) {
        onCancel();
        return;
      }
      if (key.downArrow) {
        setCursor((i) => Math.min(filtered.length - 1, i + 1));
        return;
      }
      if (key.upArrow) {
        setCursor((i) => Math.max(0, i - 1));
        return;
      }
      if (_input === ' ') {
        // Toggle the item at cursor
        const item = filtered[clampedCursor];
        if (item) {
          const lower = item.toLowerCase();
          if (selectedSet.has(lower)) {
            onChange(selected.filter((s) => s.toLowerCase() !== lower));
          } else {
            onChange([...selected, item]);
          }
        }
        return;
      }
      if (key.return) {
        // If there's filter text and no exact match in suggestions, add as freeform label
        if (
          query.trim() &&
          !suggestions.some(
            (s) => s.toLowerCase() === query.trim().toLowerCase(),
          )
        ) {
          const newLabel = query.trim();
          if (!selectedSet.has(newLabel.toLowerCase())) {
            onChange([...selected, newLabel]);
          }
          setQuery('');
          return;
        }
        // Otherwise confirm and close
        onSubmit();
        return;
      }
    },
    { isActive: focus },
  );

  const handleQueryChange = (value: string) => {
    // Space is used for toggling, strip it
    value = value.replaceAll(' ', '');
    if (value === query) return;
    setQuery(value);
    setCursor(0);
  };

  return (
    <Box flexDirection="column">
      <TextInput
        value={query}
        onChange={handleQueryChange}
        focus={focus}
        placeholder="Filter labels..."
      />
      {selected.length > 0 && (
        <Box gap={1} marginTop={0}>
          <Text dimColor={mutedDim}>Selected:</Text>
          {selected.map((l) => (
            <ColorPill key={l} field="label" value={l} />
          ))}
        </Box>
      )}
      {visible.length > 0 ? (
        <Box flexDirection="column">
          {visible.map((item, i) => {
            const isSelected = i === visibleCursor;
            const isToggled = selectedSet.has(item.toLowerCase());
            return (
              <Box
                key={item}
                backgroundColor={isSelected ? selectionBg : undefined}
              >
                <Text
                  color={isSelected ? autoFg(selectionBg) : undefined}
                  bold={isSelected}
                >
                  {isToggled ? '☑ ' : '☐ '}
                </Text>
                <ColorPill
                  field="label"
                  value={item}
                  selectionBg={isSelected ? selectionBg : undefined}
                />
              </Box>
            );
          })}
        </Box>
      ) : query ? (
        <Text dimColor={mutedDim}>
          No matches (enter to add &quot;{query}&quot;)
        </Text>
      ) : (
        <Text dimColor={mutedDim}>No labels available</Text>
      )}
      {filtered.length > MAX_VISIBLE && (
        <Text dimColor={mutedDim}>+{filtered.length - MAX_VISIBLE} more</Text>
      )}
      <Text dimColor={mutedDim}>
        space toggle enter {query ? 'add' : 'confirm'} esc cancel
      </Text>
    </Box>
  );
}
