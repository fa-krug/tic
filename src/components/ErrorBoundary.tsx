import { Component, type ReactNode } from 'react';
import { Box, Text, useInput } from 'ink';
import { useThemeStore } from '../stores/themeStore.js';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

function ErrorScreen({
  error,
  onRetry,
}: {
  error: Error;
  onRetry: () => void;
}) {
  const { error: errorColor, mutedDim } = useThemeStore((s) => s.colors);

  useInput((input) => {
    if (input === 'q') {
      process.exit(1);
    }
    if (input === 'r') {
      onRetry();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color={errorColor}>
        Something went wrong
      </Text>
      <Text>{error.message}</Text>
      <Box marginTop={1}>
        <Text dimColor={mutedDim}>Press r to retry, q to quit</Text>
      </Box>
    </Box>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  override render() {
    if (this.state.error) {
      return (
        <ErrorScreen error={this.state.error} onRetry={this.handleRetry} />
      );
    }
    return this.props.children;
  }
}
