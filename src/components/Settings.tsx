import { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { useAppState } from '../app.js';
import { readConfig, writeConfig } from '../backends/local/config.js';
import type { Config } from '../backends/local/config.js';
import { VALID_BACKENDS } from '../backends/factory.js';

export function Settings() {
  const { navigate } = useAppState();
  const root = process.cwd();

  const [config, setConfig] = useState<Config | null>(null);

  useEffect(() => {
    void readConfig(root).then(setConfig);
  }, [root]);

  const [cursor, setCursor] = useState(0);

  // Update cursor when config loads
  useEffect(() => {
    if (config) {
      setCursor(
        Math.max(
          0,
          VALID_BACKENDS.indexOf(
            config.backend as (typeof VALID_BACKENDS)[number],
          ),
        ),
      );
    }
  }, [config]);

  useInput((input, key) => {
    if (!config) return;

    if (key.escape || input === ',') {
      navigate('list');
      return;
    }

    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
    }
    if (key.downArrow) {
      setCursor((c) => Math.min(VALID_BACKENDS.length - 1, c + 1));
    }

    if (key.return) {
      const selected = VALID_BACKENDS[cursor]!;
      if (selected !== 'local' && selected !== 'github') {
        // Non-local/github backends not yet available
        return;
      }
      config.backend = selected;
      void writeConfig(root, config);
    }
  });

  if (!config) {
    return (
      <Box>
        <Text dimColor>Loading...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Settings
        </Text>
      </Box>

      <Text bold>Backend:</Text>
      {VALID_BACKENDS.map((b, idx) => {
        const selected = idx === cursor;
        const isCurrent = b === config.backend;
        const available = b === 'local' || b === 'github';
        return (
          <Box key={b}>
            <Text color={selected ? 'cyan' : undefined}>
              {selected ? '>' : ' '}{' '}
            </Text>
            <Text
              color={selected ? 'cyan' : undefined}
              bold={selected}
              dimColor={!available}
            >
              {b}
              {isCurrent ? ' (current)' : ''}
              {!available ? ' (not yet available)' : ''}
            </Text>
          </Box>
        );
      })}

      <Box marginTop={1} flexDirection="column">
        <Text bold>Project Config:</Text>
        <Box marginLeft={2}>
          <Text dimColor>Types: {config.types.join(', ')}</Text>
        </Box>
        <Box marginLeft={2}>
          <Text dimColor>Statuses: {config.statuses.join(', ')}</Text>
        </Box>
        <Box marginLeft={2}>
          <Text dimColor>Iterations: {config.iterations.join(', ')}</Text>
        </Box>
        <Box marginLeft={2}>
          <Text dimColor>Current iteration: {config.current_iteration}</Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>up/down: navigate enter: select esc/,: back</Text>
      </Box>
    </Box>
  );
}
