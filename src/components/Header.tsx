import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { useConfigStore } from '../stores/configStore.js';
import { useBackendDataStore } from '../stores/backendDataStore.js';
import os from 'node:os';
import { VERSION } from '../version.js';

export const BACKEND_LABELS: Record<string, string> = {
  local: 'Local',
  github: 'GitHub',
  gitlab: 'GitLab',
  azure: 'Azure DevOps',
  jira: 'Jira',
};

function shortenPath(fullPath: string): string {
  const home = os.homedir();
  if (fullPath.startsWith(home)) {
    return '~' + fullPath.slice(home.length);
  }
  return fullPath;
}

// Checkmark icon in block characters
const ART_LINES = ['        ██', '       ██ ', '  ██  ██  ', '   ████   '];

function getStatusDisplay(
  loading: boolean,
  initError: string | null,
  syncStatus: {
    state: string;
    pendingCount: number;
    errors: { message: string }[];
  } | null,
): { showSpinner: boolean; text: string | null; isError?: boolean } {
  if (loading) {
    return { showSpinner: true, text: 'Loading...' };
  }
  if (initError) {
    return { showSpinner: false, text: `⚠ Connection failed`, isError: true };
  }
  if (syncStatus?.state === 'syncing') {
    return { showSpinner: true, text: 'Syncing...' };
  }
  if (syncStatus?.state === 'error') {
    return {
      showSpinner: false,
      text: `⚠ Sync failed (${syncStatus.errors.length} errors)`,
    };
  }
  if (syncStatus && syncStatus.pendingCount > 0) {
    return { showSpinner: false, text: `↑ ${syncStatus.pendingCount} pending` };
  }
  if (syncStatus) {
    return { showSpinner: false, text: '✓ Synced' };
  }
  return { showSpinner: false, text: null };
}

export function Header() {
  const backendType = useConfigStore((s) => s.config.backend ?? 'local');
  const loading = useBackendDataStore((s) => s.loading);
  const initError = useBackendDataStore((s) => s.error);
  const syncStatus = useBackendDataStore((s) => s.syncStatus);
  const backendLabel = BACKEND_LABELS[backendType] ?? backendType;
  const root = process.cwd();
  const projectPath = shortenPath(root);

  const {
    showSpinner,
    text: statusText,
    isError,
  } = getStatusDisplay(loading, initError, syncStatus);

  return (
    <Box marginTop={1} marginBottom={1}>
      <Box flexDirection="column" marginRight={3}>
        {ART_LINES.map((line, i) => (
          <Text key={i} color="cyan">
            {line}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" justifyContent="center">
        <Text>
          <Text bold>tic</Text>
          <Text dimColor> v{VERSION}</Text>
          {showSpinner && (
            <Text color="yellow">
              {' '}
              <Spinner type="dots" />
            </Text>
          )}
          {statusText && (
            <Text color={isError ? 'red' : undefined} dimColor={!isError}>
              {' '}
              {statusText}
            </Text>
          )}
        </Text>
        <Text dimColor>
          {backendLabel} · {projectPath}
        </Text>
      </Box>
    </Box>
  );
}
