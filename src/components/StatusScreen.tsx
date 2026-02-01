import { useState, useMemo, useEffect } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import { useAppState } from '../app.js';
import type { SyncStatus } from '../sync/types.js';
import type { BackendCapabilities } from '../backends/types.js';

function CapabilityLine({
  label,
  enabled,
}: {
  label: string;
  enabled: boolean;
}) {
  return (
    <Text>
      {enabled ? <Text color="green">✓</Text> : <Text dimColor>✗</Text>} {label}
    </Text>
  );
}

export function StatusScreen() {
  const { backend, syncManager, navigate } = useAppState();
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows ?? 24;

  const capabilities: BackendCapabilities = useMemo(
    () => backend.getCapabilities(),
    [backend],
  );

  const backendName = backend.constructor.name.replace(/Backend$/, '');

  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(
    syncManager?.getStatus() ?? null,
  );

  useEffect(() => {
    if (!syncManager) return;
    const cb = (status: SyncStatus) => setSyncStatus(status);
    syncManager.onStatusChange(cb);
  }, [syncManager]);

  const errors = syncStatus?.errors ?? [];
  const [scrollOffset, setScrollOffset] = useState(0);

  // Reserve lines for header, backend, capabilities, sync summary, help bar
  // Approximate: header(2) + backend(2) + capabilities header(1) + 5 features + 5 fields + gap(1) + sync header(1) + sync lines(4) + help(2) = ~23
  // Errors section gets remaining space
  const fixedLines = syncManager ? 23 : 17;
  const availableErrorLines = Math.max(3, terminalHeight - fixedLines);
  const maxScroll = Math.max(0, errors.length - availableErrorLines);

  useInput((input, key) => {
    if (key.escape || input === 'q') {
      navigate('list');
      return;
    }

    if (key.upArrow) {
      setScrollOffset((o) => Math.max(0, o - 1));
    }
    if (key.downArrow) {
      setScrollOffset((o) => Math.min(maxScroll, o + 1));
    }
  });

  const visibleErrors = errors.slice(
    scrollOffset,
    scrollOffset + availableErrorLines,
  );

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Status
        </Text>
      </Box>

      <Text bold>Backend:</Text>
      <Box marginLeft={2} marginBottom={1}>
        <Text>{backendName}</Text>
      </Box>

      <Text bold>Capabilities:</Text>
      <Box marginLeft={2} flexDirection="column">
        <CapabilityLine
          label="Relationships"
          enabled={capabilities.relationships}
        />
        <CapabilityLine
          label="Custom types"
          enabled={capabilities.customTypes}
        />
        <CapabilityLine
          label="Custom statuses"
          enabled={capabilities.customStatuses}
        />
        <CapabilityLine label="Iterations" enabled={capabilities.iterations} />
        <CapabilityLine label="Comments" enabled={capabilities.comments} />
        <CapabilityLine
          label="Priority"
          enabled={capabilities.fields.priority}
        />
        <CapabilityLine
          label="Assignee"
          enabled={capabilities.fields.assignee}
        />
        <CapabilityLine label="Labels" enabled={capabilities.fields.labels} />
        <CapabilityLine label="Parent" enabled={capabilities.fields.parent} />
        <CapabilityLine
          label="Dependencies"
          enabled={capabilities.fields.dependsOn}
        />
      </Box>

      {syncManager && syncStatus && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Sync:</Text>
          <Box marginLeft={2} flexDirection="column">
            <Text>
              State:{' '}
              {syncStatus.state === 'syncing' ? (
                <Text color="yellow">syncing</Text>
              ) : syncStatus.state === 'error' ? (
                <Text color="red">error</Text>
              ) : (
                <Text color="green">idle</Text>
              )}
            </Text>
            <Text>Pending: {syncStatus.pendingCount}</Text>
            <Text>
              Last sync:{' '}
              {syncStatus.lastSyncTime
                ? syncStatus.lastSyncTime.toLocaleString()
                : 'never'}
            </Text>
          </Box>

          {errors.length > 0 && (
            <Box marginTop={1} flexDirection="column">
              <Text bold color="red">
                Errors ({errors.length}):
              </Text>
              {visibleErrors.map((err, idx) => (
                <Box
                  key={scrollOffset + idx}
                  marginLeft={2}
                  flexDirection="column"
                >
                  <Text color="red">
                    [{err.entry.action}] #{err.entry.itemId}: {err.message}
                  </Text>
                  <Text dimColor> {err.timestamp}</Text>
                </Box>
              ))}
              {errors.length > availableErrorLines && (
                <Text dimColor>
                  {' '}
                  ↑↓ scroll ({scrollOffset + 1}-
                  {Math.min(scrollOffset + availableErrorLines, errors.length)}{' '}
                  of {errors.length})
                </Text>
              )}
            </Box>
          )}
        </Box>
      )}

      {!syncManager && (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Sync:</Text>
          <Box marginLeft={2}>
            <Text dimColor>Not available (local-only mode)</Text>
          </Box>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>esc: back</Text>
      </Box>
    </Box>
  );
}
