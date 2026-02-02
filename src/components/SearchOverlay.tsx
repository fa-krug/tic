import { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { fuzzyMatch, type FuzzyResult } from './fuzzyMatch.js';
import type { WorkItem } from '../types.js';

export interface SearchOverlayProps {
  items: WorkItem[];
  currentIteration: string | null;
  onSelect: (item: WorkItem) => void;
  onCancel: () => void;
}

export function groupResults(
  results: FuzzyResult[],
  currentIteration: string | null,
  maxResults: number = 10,
): FuzzyResult[] {
  const sortByScore = (a: FuzzyResult, b: FuzzyResult) => b.score - a.score;

  if (!currentIteration) {
    return [...results].sort(sortByScore).slice(0, maxResults);
  }
  const current = results
    .filter((r) => r.item.iteration === currentIteration)
    .sort(sortByScore);
  const other = results
    .filter((r) => r.item.iteration !== currentIteration)
    .sort(sortByScore);
  return [...current, ...other].slice(0, maxResults);
}

export function SearchOverlay({
  items,
  currentIteration,
  onSelect,
  onCancel,
}: SearchOverlayProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const results = useMemo(() => {
    const matched = fuzzyMatch(items, query);
    return groupResults(matched, currentIteration);
  }, [items, query, currentIteration]);

  // Find the boundary between current and other iteration results
  const currentIterationCount = useMemo(() => {
    if (!currentIteration) return 0;
    return results.filter((r) => r.item.iteration === currentIteration).length;
  }, [results, currentIteration]);

  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(results.length - 1, i + 1));
    }
    if (key.return && results.length > 0) {
      const selected = results[selectedIndex];
      if (selected) {
        onSelect(selected.item);
      }
    }
  });

  // Reset selection when query changes
  const handleQueryChange = (value: string) => {
    setQuery(value);
    setSelectedIndex(0);
  };

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
    >
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Search{' '}
        </Text>
        <TextInput
          value={query}
          onChange={handleQueryChange}
          focus={true}
          placeholder="Type to search..."
        />
      </Box>

      {query.trim() === '' && (
        <Text dimColor>Type to search by title, ID, or label...</Text>
      )}

      {query.trim() !== '' && results.length === 0 && (
        <Text dimColor>No items found</Text>
      )}

      {results.map((result, index) => {
        const showCurrentHeader =
          currentIteration && currentIterationCount > 0 && index === 0;
        const showOtherHeader =
          currentIteration &&
          currentIterationCount > 0 &&
          index === currentIterationCount;

        return (
          <Box key={result.item.id} flexDirection="column">
            {showCurrentHeader && <Text dimColor>Current iteration:</Text>}
            {showOtherHeader && (
              <Box marginTop={1}>
                <Text dimColor>Other iterations:</Text>
              </Box>
            )}
            <Box>
              <Text
                color={index === selectedIndex ? 'cyan' : undefined}
                bold={index === selectedIndex}
              >
                {index === selectedIndex ? '● ' : '  '}
              </Text>
              <Box width={8}>
                <Text color={index === selectedIndex ? 'cyan' : 'yellow'}>
                  #{result.item.id}
                </Text>
              </Box>
              <Text color={index === selectedIndex ? 'cyan' : undefined}>
                {result.item.title}
              </Text>
              {result.item.labels.length > 0 && (
                <Text dimColor> [{result.item.labels.join(', ')}]</Text>
              )}
              <Text dimColor> ({result.item.type})</Text>
            </Box>
          </Box>
        );
      })}

      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate enter select esc cancel</Text>
      </Box>
    </Box>
  );
}
