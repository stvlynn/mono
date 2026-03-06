import { Box, Text, useInput } from "ink";
import type { ApprovalDialog as ApprovalDialogType } from "../types/ui.js";
import { useUIActions } from "../contexts/UIActionsContext.js";

export function ApprovalDialog({ dialog }: { dialog: ApprovalDialogType }) {
  const actions = useUIActions();

  useInput((input, key) => {
    if (key.escape || input.toLowerCase() === "n") {
      dialog.resolve(false);
      actions.closeTopDialog();
      actions.setStatus(`Denied ${dialog.toolName}`);
      return;
    }
    if (key.return || input.toLowerCase() === "y") {
      dialog.resolve(true);
      actions.closeTopDialog();
      actions.setStatus(`Approved ${dialog.toolName}`);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" padding={1}>
      <Text bold color="yellow">{dialog.title}</Text>
      <Text>{dialog.reason}</Text>
      <Text dimColor>{dialog.input}</Text>
      <Text dimColor>Press y or Enter to approve. Press n or Esc to deny.</Text>
    </Box>
  );
}
