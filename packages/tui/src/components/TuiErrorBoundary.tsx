import { Box, Text } from "ink";
import { Component, type ReactNode } from "react";

interface TuiErrorBoundaryProps {
  children: ReactNode;
  onError: (error: unknown) => void;
}

interface TuiErrorBoundaryState {
  hasError: boolean;
}

export class TuiErrorBoundary extends Component<TuiErrorBoundaryProps, TuiErrorBoundaryState> {
  state: TuiErrorBoundaryState = {
    hasError: false
  };

  static getDerivedStateFromError(): TuiErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: unknown): void {
    this.props.onError(error);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <Box flexDirection="column" borderStyle="round" borderColor="red" padding={1}>
          <Text color="red" bold>
            TUI encountered a fatal error
          </Text>
          <Text dimColor>Check the status line for details. Use Ctrl+C twice to exit.</Text>
        </Box>
      );
    }

    return this.props.children;
  }
}
