import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import {
  backendDataStore,
  useBackendDataStore,
} from '../stores/backendDataStore.js';
import { useThemeStore } from '../stores/themeStore.js';
import { useShallow } from 'zustand/shallow';
import { BACKEND_LABELS } from './Header.js';

export function AuthPrompt() {
  const {
    accent,
    error: errorColor,
    warning: warningColor,
    mutedDim,
  } = useThemeStore((s) => s.colors);
  const { authPrompt, authFlow } = useBackendDataStore(
    useShallow((s) => ({
      authPrompt: s.authPrompt,
      authFlow: s.authFlow,
    })),
  );
  const [pat, setPat] = useState('');
  const [jiraEmail, setJiraEmail] = useState('');
  const [jiraEmailInput, setJiraEmailInput] = useState('');
  const [jiraToken, setJiraToken] = useState('');

  const isPolling =
    authFlow?.state === 'waiting' ||
    authFlow?.state === 'code-ready' ||
    authFlow?.state === 'entering-pat' ||
    authFlow?.state === 'entering-jira-credentials';

  useInput(
    (_input, key) => {
      if (key.return && !isPolling) {
        void backendDataStore
          .getState()
          .startAuthFlow()
          .catch(() => {});
        return;
      }
      if (key.escape) {
        backendDataStore.getState().dismissAuthPrompt();
      }
      if (_input === 'p' && authPrompt?.backendType === 'azure' && !isPolling) {
        backendDataStore.getState().startPatFlow();
      }
    },
    {
      isActive:
        authFlow?.state !== 'entering-pat' &&
        authFlow?.state !== 'entering-jira-credentials',
    },
  );

  if (!authPrompt) return null;

  const backendLabel =
    BACKEND_LABELS[authPrompt.backendType] ?? authPrompt.backendType;

  // PAT input
  if (authFlow?.state === 'entering-pat') {
    return (
      <Box
        borderStyle="round"
        borderColor="yellow"
        flexDirection="column"
        paddingX={2}
        paddingY={1}
      >
        <Text bold color={warningColor}>
          Enter Azure DevOps PAT
        </Text>
        <Box marginTop={1}>
          <Text>PAT: </Text>
          <TextInput
            value={pat}
            onChange={setPat}
            mask="*"
            onSubmit={(val) => {
              void backendDataStore
                .getState()
                .submitAdoPat(val)
                .catch(() => {});
            }}
          />
        </Box>
        <Box marginTop={1}>
          <Text dimColor={mutedDim}>enter submit esc cancel</Text>
        </Box>
      </Box>
    );
  }

  // Jira credentials input (two-step: email then token)
  if (authFlow?.state === 'entering-jira-credentials') {
    if (!jiraEmail) {
      // Step 1: Email
      return (
        <Box
          borderStyle="round"
          borderColor="yellow"
          flexDirection="column"
          paddingX={2}
          paddingY={1}
        >
          <Text bold color={warningColor}>
            Jira Authentication
          </Text>
          <Text dimColor={mutedDim}>
            Generate a token at
            https://id.atlassian.com/manage-profile/security/api-tokens
          </Text>
          <Box marginTop={1}>
            <Text>Email: </Text>
            <TextInput
              value={jiraEmailInput}
              onChange={setJiraEmailInput}
              onSubmit={(val) => {
                if (val) setJiraEmail(val);
              }}
            />
          </Box>
          <Box marginTop={1}>
            <Text dimColor={mutedDim}>enter next esc cancel</Text>
          </Box>
        </Box>
      );
    }

    // Step 2: Token
    return (
      <Box
        borderStyle="round"
        borderColor="yellow"
        flexDirection="column"
        paddingX={2}
        paddingY={1}
      >
        <Text bold color={warningColor}>
          Jira Authentication
        </Text>
        <Box marginTop={1}>
          <Text>
            Email: <Text bold>{jiraEmail}</Text>
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text>Token: </Text>
          <TextInput
            value={jiraToken}
            onChange={setJiraToken}
            mask="*"
            onSubmit={(val) => {
              if (jiraEmail && val) {
                void backendDataStore
                  .getState()
                  .submitJiraCredentials(jiraEmail, val)
                  .catch(() => {});
              }
            }}
          />
        </Box>
        <Box marginTop={1}>
          <Text dimColor={mutedDim}>enter submit esc cancel</Text>
        </Box>
      </Box>
    );
  }

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
        <Text bold color={warningColor}>
          {backendLabel} Authentication
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text>
            Visit:{' '}
            <Text bold color={accent}>
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
          <Text color={warningColor}>
            <Spinner type="dots" />
          </Text>
          <Text dimColor={mutedDim}> Waiting for authorization...</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor={mutedDim}>esc skip</Text>
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
        <Text bold color={errorColor}>
          Authentication Failed
        </Text>
        <Box marginTop={1}>
          <Text color={errorColor}>{authFlow.error}</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor={mutedDim}>enter retry esc skip</Text>
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
        <Text bold color={warningColor}>
          {backendLabel} Authentication Required
        </Text>
        <Box marginTop={1}>
          <Text color={warningColor}>
            <Spinner type="dots" />
          </Text>
          <Text dimColor={mutedDim}> Connecting...</Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor={mutedDim}>esc skip</Text>
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
      <Text bold color={warningColor}>
        {backendLabel} Authentication Required
      </Text>
      <Box marginTop={1}>
        <Text>{authPrompt.message}</Text>
      </Box>
      <Box marginTop={1}>
        <Text dimColor={mutedDim}>
          enter authenticate
          {authPrompt.backendType === 'azure' && '  p use PAT'} esc skip
          (local-only mode)
        </Text>
      </Box>
    </Box>
  );
}
