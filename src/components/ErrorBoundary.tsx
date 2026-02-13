import { Component, type ReactNode } from 'react';
import { Box, Text, useInput } from 'ink';

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
      <Text bold color="red">
        Something went wrong
      </Text>
      <Text>{error.message}</Text>
      <Box marginTop={1}>
        <Text dimColor>Press r to retry, q to quit</Text>
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
