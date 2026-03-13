import { Box, Text } from "ink";
import { useCallback, useState } from "react";
import { useForegroundKeypress } from "../contexts/ForegroundKeypressContext.js";
import { useUIActions } from "../contexts/UIActionsContext.js";
import { InputBuffer } from "../input-buffer.js";
import { isBackwardDeleteInput, isForwardDeleteInput } from "../input-keys.js";
import { isInsertableInput, type RawKey } from "../hooks/useRawKeypress.js";
import type { InputDialog as InputDialogType } from "../types/ui.js";

export function InputDialog({ dialog }: { dialog: InputDialogType }) {
  const actions = useUIActions();
  const [buffer] = useState(() => {
    const next = new InputBuffer();
    if (dialog.initialValue) {
      next.setText(dialog.initialValue);
    }
    return next;
  });
  const [, forceUpdate] = useState(0);

  const refresh = useCallback(() => {
    forceUpdate((value) => value + 1);
  }, []);

  const handleKeypress = useCallback((input: string, key: RawKey) => {
    if (key.ctrl && key.name === "c") {
      void actions.handleInterrupt();
      return;
    }
    if (key.escape) {
      actions.closeTopDialog();
      return;
    }
    if (key.return) {
      void (async () => {
        try {
          await dialog.onSubmit(buffer.text);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error || "Failed to submit input");
          actions.setStatus(message && message !== "undefined" ? message : "Failed to submit input");
        }
      })();
      return;
    }
    if (key.leftArrow) {
      buffer.moveLeft();
      refresh();
      return;
    }
    if (key.rightArrow) {
      buffer.moveRight();
      refresh();
      return;
    }
    if (key.home || (key.ctrl && key.name === "a")) {
      buffer.moveHome();
      refresh();
      return;
    }
    if (key.end || (key.ctrl && key.name === "e")) {
      buffer.moveEnd();
      refresh();
      return;
    }
    if (isBackwardDeleteInput(input, key)) {
      buffer.deleteBackward();
      refresh();
      return;
    }
    if (isForwardDeleteInput(input, key)) {
      buffer.deleteForward();
      refresh();
      return;
    }
    if (isInsertableInput(input, key)) {
      buffer.insert(input);
      refresh();
    }
  }, [actions, buffer, dialog, refresh]);

  useForegroundKeypress(handleKeypress);

  const displayValue = dialog.secret
    ? "•".repeat(buffer.text.length)
    : buffer.text;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="green" padding={1}>
      <Text bold>{dialog.title}</Text>
      <Text>{dialog.label}</Text>
      <Text color="green">
        {displayValue || dialog.placeholder || "<empty>"}
      </Text>
      <Text dimColor>{dialog.hint ?? "Type a value, Enter submit, Esc close"}</Text>
    </Box>
  );
}
