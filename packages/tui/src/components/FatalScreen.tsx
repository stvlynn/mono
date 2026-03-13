import { Box, Text } from "ink";
import { useForegroundKeypress } from "../contexts/ForegroundKeypressContext.js";
import { useUIActions } from "../contexts/UIActionsContext.js";
import { useUIState } from "../contexts/UIStateContext.js";
import type { RawKey } from "../hooks/useRawKeypress.js";

export function FatalScreen() {
  const actions = useUIActions();
  const { fatalError } = useUIState();

  const handleKeypress = (input: string, key: RawKey) => {
    if (key.ctrl && key.name === "c") {
      void actions.handleInterrupt();
      return;
    }

    if (key.escape) {
      actions.dismissFatalError();
      return;
    }

    if (key.return || input === "q" || input === "Q") {
      void actions.requestShutdown();
    }
  };

  useForegroundKeypress(handleKeypress, true);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="red" padding={1}>
      <Text color="red" bold>
        Fatal UI error
      </Text>
      <Text>{fatalError ?? "Unknown fatal error"}</Text>
      <Text dimColor>Esc dismiss · Enter or q quit · Ctrl+C interrupt</Text>
    </Box>
  );
}
