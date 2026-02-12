import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import {
  backendDataStore,
  useBackendDataStore,
} from '../stores/backendDataStore.js';
import { BACKEND_LABELS } from './Header.js';

export function AuthPrompt() {
  const authPrompt = useBackendDataStore((s) => s.authPrompt);
  const authFlow = useBackendDataStore((s) => s.authFlow);

  const isPolling =
    authFlow?.state === 'waiting' || authFlow?.state === 'code-ready';

  useInput((_input, key) => {
    if (key.return && !isPolling) {
      void backendDataStore.getState().startAuthFlow();
      return;
    }
    if (key.escape) {
      backendDataStore.getState().dismissAuthPrompt();
    }
  });

  if (!authPrompt) return null;

  const backendLabel =
    BACKEND_LABELS[authPrompt.backendType] ?? authPrompt.backendType;

  // Code ready — show device code
  if (authFlow?.state === 'code-ready') {
    return (
      <Box
        borderStyle="round"
        borderColor="yellow"
        flexDirection="column"
        paddingX={2}
        paddingY={1}
      >
        <Text bold color="yellow">
          {backendLabel} Authentication
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text>
            Visit:{' '}
            <Text bold color="cyan">
              {authFlow.verificationUri}
            </Text>
          </Text>
          <Text>
            Enter code:{' '}
            <Text bold color="white">
              {authFlow.userCode}
            </Text>
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text color="yellow">
            <Spinner type="dots" />
          </Text>
          <Text dimColor> Waiting for authorization...</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>esc skip</Text>
        </Box>
      </Box>
    );
  }

  // Error state
  if (authFlow?.state === 'error') {
    return (
      <Box
        borderStyle="round"
        borderColor="red"
        flexDirection="column"
        paddingX={2}
        paddingY={1}
      >
        <Text bold color="red">
          Authentication Failed
        </Text>
        <Box marginTop={1}>
          <Text color="red">{authFlow.error}</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>enter retry esc skip</Text>
        </Box>
      </Box>
    );
  }

  // Waiting state (request in progress)
  if (authFlow?.state === 'waiting') {
    return (
      <Box
        borderStyle="round"
        borderColor="yellow"
        flexDirection="column"
        paddingX={2}
        paddingY={1}
      >
        <Text bold color="yellow">
          {backendLabel} Authentication Required
        </Text>
        <Box marginTop={1}>
          <Text color="yellow">
            <Spinner type="dots" />
          </Text>
          <Text dimColor> Connecting...</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>esc skip</Text>
        </Box>
      </Box>
    );
  }

  // Initial state — prompt to authenticate
  return (
    <Box
      borderStyle="round"
      borderColor="yellow"
      flexDirection="column"
      paddingX={2}
      paddingY={1}
    >
      <Text bold color="yellow">
        {backendLabel} Authentication Required
      </Text>
      <Box marginTop={1}>
        <Text>{authPrompt.message}</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor>enter authenticate esc skip (local-only mode)</Text>
      </Box>
    </Box>
  );
}
