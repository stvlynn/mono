import { Box, Text } from "ink";
import { useCallback } from "react";
import type { InfoDialog as InfoDialogType } from "../types/ui.js";
import { useForegroundKeypress } from "../contexts/ForegroundKeypressContext.js";
import { useUIActions } from "../contexts/UIActionsContext.js";
import type { RawKey } from "../hooks/useRawKeypress.js";

export function InfoDialog({ dialog }: { dialog: InfoDialogType }) {
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
      <Text bold>{dialog.title}</Text>
      {dialog.body.map((line, index) => (
        <Text key={`${dialog.id}-${index}`}>{line}</Text>
      ))}
      <Text dimColor>Esc close</Text>
    </Box>
  );
}
