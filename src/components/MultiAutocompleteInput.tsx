import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

const MAX_VISIBLE = 5;

interface MultiAutocompleteInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  suggestions: string[];
  focus: boolean;
}

function parseSegments(value: string): { prefix: string; current: string } {
  const lastComma = value.lastIndexOf(',');
  if (lastComma === -1) {
    return { prefix: '', current: value.trim() };
  }
  return {
    prefix: value.slice(0, lastComma + 1) + ' ',
    current: value.slice(lastComma + 1).trim(),
  };
}

function getExistingLabels(value: string): Set<string> {
  return new Set(
    value
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0),
  );
}

export function filterSuggestions(
  value: string,
  suggestions: string[],
): string[] {
  const { current } = parseSegments(value);
  const existing = getExistingLabels(value);

  // Filter out already-selected labels and match on current segment
  const filtered = suggestions.filter((s) => {
    const lower = s.toLowerCase();
    // Don't suggest labels that are already in the value
    if (existing.has(lower)) return false;
    // Match if current segment is empty or contained in suggestion
    return !current || lower.includes(current.toLowerCase());
  });

  return filtered.slice(0, MAX_VISIBLE);
}

export function MultiAutocompleteInput({
  value,
  onChange,
  onSubmit,
  suggestions,
  focus,
}: MultiAutocompleteInputProps) {
  const [highlightIndex, setHighlightIndex] = useState(-1);

  const visible = filterSuggestions(value, suggestions);
  const { prefix } = parseSegments(value);

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
          // Replace only the current segment with the selected suggestion
          onChange(prefix + visible[highlightIndex]!);
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
            onChange(prefix + visible[highlightIndex]!);
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
