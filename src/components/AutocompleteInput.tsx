import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

const MAX_VISIBLE = 5;

interface AutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  suggestions: string[];
  focus: boolean;
}

export function filterSuggestions(
  value: string,
  suggestions: string[],
): string[] {
  const filtered = value
    ? suggestions.filter((s) => s.toLowerCase().includes(value.toLowerCase()))
    : suggestions;
  return filtered.slice(0, MAX_VISIBLE);
}

export function AutocompleteInput({
  value,
  onChange,
  onSubmit,
  suggestions,
  focus,
}: AutocompleteInputProps) {
  const [highlightIndex, setHighlightIndex] = useState(-1);

  const visible = filterSuggestions(value, suggestions);

  useInput(
    (_input, key) => {
      if (key.downArrow) {
        setHighlightIndex((i) => (i < visible.length - 1 ? i + 1 : i));
      }
      if (key.upArrow) {
        setHighlightIndex((i) => (i > -1 ? i - 1 : -1));
      }
      if (key.return) {
        if (highlightIndex >= 0 && highlightIndex < visible.length) {
          onChange(visible[highlightIndex]!);
        }
        onSubmit();
      }
    },
    { isActive: focus },
  );

  const handleChange = (newValue: string) => {
    onChange(newValue);
    setHighlightIndex(-1);
  };

  return (
    <Box flexDirection="column">
      <TextInput
        value={value}
        onChange={handleChange}
        focus={focus}
        onSubmit={() => {
          if (highlightIndex >= 0 && highlightIndex < visible.length) {
            onChange(visible[highlightIndex]!);
          }
          onSubmit();
        }}
      />
      {visible.length > 0 && (
        <Box flexDirection="column" marginLeft={2}>
          {visible.map((suggestion, i) => (
            <Text
              key={suggestion}
              color={i === highlightIndex ? 'cyan' : undefined}
              bold={i === highlightIndex}
            >
              {i === highlightIndex ? '> ' : '  '}
              {suggestion}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
