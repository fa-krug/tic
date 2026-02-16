import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { useConfigStore } from '../stores/configStore.js';
import { useBackendDataStore } from '../stores/backendDataStore.js';
import { useThemeStore } from '../stores/themeStore.js';
import os from 'node:os';
import { VERSION } from '../version.js';

export const BACKEND_LABELS: Record<string, string> = {
  none: 'Local',
  filesystem: 'Local (filesystem)',
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
  branchesLoading: boolean,
  initError: string | null,
  syncStatus: {
    state: string;
    pendingCount: number;
    errors: { message: string }[];
    progress: { phase: string; current: number; total: number } | null;
  } | null,
  authDismissed: boolean,
): { showSpinner: boolean; text: string | null; isError?: boolean } {
  if (loading) {
    return { showSpinner: true, text: 'Loading...' };
  }
  if (branchesLoading) {
    return { showSpinner: true, text: 'Fetching...' };
  }
  if (initError) {
    return { showSpinner: false, text: `⚠ Connection failed`, isError: true };
  }
  if (syncStatus?.state === 'syncing') {
    if (syncStatus.progress?.phase === 'push') {
      return {
        showSpinner: true,
        text: `↑ ${syncStatus.progress.current}/${syncStatus.progress.total}`,
      };
    }
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
  if (authDismissed) {
    return {
      showSpinner: false,
      text: '⚠ Not authenticated',
      isError: true,
    };
  }
  return { showSpinner: false, text: null };
}

export function Header() {
  const { accent, error, warning, mutedDim } = useThemeStore((s) => s.colors);
  const backendType = useConfigStore((s) => s.config.backend ?? 'none');
  const loading = useBackendDataStore((s) => s.loading);
  const branchesLoading = useBackendDataStore((s) => s.branchesLoading);
  const initError = useBackendDataStore((s) => s.error);
  const syncStatus = useBackendDataStore((s) => s.syncStatus);
  const authDismissed = useBackendDataStore((s) => s.authDismissed);
  const backendLabel = BACKEND_LABELS[backendType] ?? backendType;
  const root = process.cwd();
  const projectPath = shortenPath(root);

  const {
    showSpinner,
    text: statusText,
    isError,
  } = getStatusDisplay(
    loading,
    branchesLoading,
    initError,
    syncStatus,
    authDismissed,
  );

  return (
    <Box marginTop={1} marginBottom={1}>
      <Box flexDirection="column" marginRight={3}>
        {ART_LINES.map((line, i) => (
          <Text key={i} color={accent}>
            {line}
          </Text>
        ))}
      </Box>
      <Box flexDirection="column" justifyContent="center">
        <Text>
          <Text bold>tic</Text>
          <Text dimColor={mutedDim}> v{VERSION}</Text>
          {showSpinner && (
            <Text color={warning}>
              {' '}
              <Spinner type="dots" />
            </Text>
          )}
          {statusText && (
            <Text color={isError ? error : undefined} dimColor={!isError}>
              {' '}
              {statusText}
            </Text>
          )}
        </Text>
        <Text dimColor={mutedDim}>
          {backendLabel} · {projectPath}
        </Text>
      </Box>
    </Box>
  );
}
