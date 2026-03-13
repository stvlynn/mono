import { Box, Text } from "ink";
import { useCallback } from "react";
import { useForegroundKeypress } from "../contexts/ForegroundKeypressContext.js";
import { useUIActions } from "../contexts/UIActionsContext.js";
import type { RawKey } from "../hooks/useRawKeypress.js";

export function HelpDialog() {
  const actions = useUIActions();

  const handleKeypress = useCallback((input: string, key: RawKey) => {
    if (key.ctrl && key.name === "c") {
      void actions.handleInterrupt();
      return;
    }

    if (key.escape || key.return || input === "q") {
      actions.closeTopDialog();
    }
  }, [actions]);

  useForegroundKeypress(handleKeypress);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
      <Text bold>Commands</Text>
      <Text>/help /model /profile /sessions /tree /memory /settings /thinking /markdown /tools /quit</Text>
      <Text dimColor>Enter submit · Ctrl+J newline · Esc close dialog · Ctrl+C interrupt · double Ctrl+C exit</Text>
    </Box>
  );
}
