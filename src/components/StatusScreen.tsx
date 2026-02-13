import { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { useNavigationStore } from '../stores/navigationStore.js';
import type { BackendCapabilities } from '../backends/types.js';
import { useScrollViewport } from '../hooks/useScrollViewport.js';
import { useBackendDataStore } from '../stores/backendDataStore.js';
import { useConfigStore } from '../stores/configStore.js';
import { BACKEND_LABELS } from './Header.js';

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
  const backend = useBackendDataStore((s) => s.backend);
  const syncManager = useBackendDataStore((s) => s.syncManager);
  const navigate = useNavigationStore((s) => s.navigate);
  const navigateToHelp = useNavigationStore((s) => s.navigateToHelp);

  const capabilities: BackendCapabilities = useMemo(
    () =>
      backend?.getCapabilities() ?? {
        relationships: false,
        customTypes: false,
        customStatuses: false,
        iterations: false,
        comments: false,
        templates: false,
        fields: {
          priority: false,
          assignee: false,
          labels: false,
          parent: false,
          dependsOn: false,
        },
        templateFields: {
          type: false,
          status: false,
          priority: false,
          assignee: false,
          labels: false,
          iteration: false,
          parent: false,
          dependsOn: false,
          description: false,
        },
      },
    [backend],
  );

  const backendType = useConfigStore((s) => s.config.backend ?? 'none');
  const backendName = BACKEND_LABELS[backendType] ?? backendType;

  const initError = useBackendDataStore((s) => s.error);
  const syncStatus = useBackendDataStore((s) => s.syncStatus);
  const authDismissed = useBackendDataStore((s) => s.authDismissed);

  const errors = syncStatus?.errors ?? [];
  const [scrollOffset, setScrollOffset] = useState(0);

  const syncLog = syncStatus?.syncLog ?? [];
  const [logScrollOffset, setLogScrollOffset] = useState(0);

  // chrome: header(2) + backend(2) + capabilities header(1) + 5 features + 5 fields + gap(1) + sync header(1) + sync lines(4) + help(2) = ~23
  const fixedLines = syncManager ? 23 : 17;
  const viewport = useScrollViewport({
    totalItems: errors.length,
    cursor: scrollOffset,
    chromeLines: fixedLines,
    linesPerItem: 2,
  });
  const maxScroll = Math.max(0, errors.length - viewport.maxVisible);

  const logFixedLines = syncManager ? 27 : 17;
  const logViewport = useScrollViewport({
    totalItems: syncLog.length,
    cursor: logScrollOffset,
    chromeLines: logFixedLines,
    linesPerItem: 1,
  });
  const maxLogScroll = Math.max(0, syncLog.length - logViewport.maxVisible);

  useInput((input, key) => {
    if (key.escape || input === 'q') {
      navigate('list');
      return;
    }

    if (input === '?') {
      navigateToHelp();
      return;
    }

    if (input === 'r' && syncManager && syncStatus?.state !== 'syncing') {
      void syncManager.sync().catch(() => {
        // Errors recorded in syncStatus by SyncManager
      });
      return;
    }

    if (key.upArrow) {
      if (syncLog.length > 0) {
        setLogScrollOffset((o) => Math.max(0, o - 1));
      } else {
        setScrollOffset((o) => Math.max(0, o - 1));
      }
    }
    if (key.downArrow) {
      if (syncLog.length > 0) {
        setLogScrollOffset((o) => Math.min(maxLogScroll, o + 1));
      } else {
        setScrollOffset((o) => Math.min(maxScroll, o + 1));
      }
    }
  });

  const visibleErrors = errors.slice(
    scrollOffset,
    scrollOffset + viewport.maxVisible,
  );

  const visibleLogEntries = syncLog.slice(
    logScrollOffset,
    logScrollOffset + logViewport.maxVisible,
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

      {initError && (
        <Box marginBottom={1} flexDirection="column">
          <Text bold color="red">
            Connection Error:
          </Text>
          <Box marginLeft={2}>
            <Text color="red">{initError}</Text>
          </Box>
        </Box>
      )}

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

          {syncLog.length > 0 && (
            <Box marginTop={1} flexDirection="column">
              <Text bold>Sync Log:</Text>
              {visibleLogEntries.map((entry, idx) => (
                <Box key={logScrollOffset + idx} marginLeft={2}>
                  <Text color={entry.result === 'success' ? 'green' : 'red'}>
                    {entry.result === 'success' ? '✓' : '✗'}
                  </Text>
                  <Text>
                    {' '}
                    {entry.phase === 'pull'
                      ? `pulled ${entry.message ?? ''}`
                      : `${entry.action} #${entry.itemId}`}
                    {entry.result === 'error' && entry.message
                      ? ` — ${entry.message}`
                      : ''}
                  </Text>
                  <Text dimColor>
                    {' '}
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </Text>
                </Box>
              ))}
              {syncLog.length > logViewport.maxVisible && (
                <Text dimColor>
                  {' '}
                  ↑↓ scroll ({logScrollOffset + 1}-
                  {Math.min(
                    logScrollOffset + logViewport.maxVisible,
                    syncLog.length,
                  )}{' '}
                  of {syncLog.length})
                </Text>
              )}
            </Box>
          )}

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
              {errors.length > viewport.maxVisible && (
                <Text dimColor>
                  {' '}
                  ↑↓ scroll ({scrollOffset + 1}-
                  {Math.min(scrollOffset + viewport.maxVisible, errors.length)}{' '}
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
            {authDismissed &&
            ['github', 'azure', 'gitlab'].includes(backendType) ? (
              <Text dimColor>
                Not available — not authenticated. Run{' '}
                <Text bold>
                  tic auth login {backendType === 'azure' ? 'ado' : backendType}
                </Text>{' '}
                to authenticate.
              </Text>
            ) : (
              <Text dimColor>
                {authDismissed
                  ? 'Not available — not authenticated.'
                  : 'Not available (local-only mode)'}
              </Text>
            )}
          </Box>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          {syncManager &&
          (errors.length > 0 || (syncStatus?.pendingCount ?? 0) > 0)
            ? '↑↓ scroll  r retry  esc back  ? help'
            : '↑↓ scroll  esc back  ? help'}
        </Text>
      </Box>
    </Box>
  );
}
