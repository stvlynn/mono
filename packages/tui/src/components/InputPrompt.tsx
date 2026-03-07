import { Box, Text } from "ink";
import { useCallback, useEffect, useState } from "react";
import stringWidth from "string-width";
import type { ReturnTypeUseComposerState } from "../hooks/useComposerState.types.js";
import type { ReturnTypeUseSlashCommands } from "../hooks/useSlashCommands.types.js";
import { useUIActions } from "../contexts/UIActionsContext.js";
import { useUIState } from "../contexts/UIStateContext.js";
import { isBackwardDeleteInput, isForwardDeleteInput } from "../input-keys.js";
import { isInsertableInput, useRawKeypress, type RawKey } from "../hooks/useRawKeypress.js";

function renderBuffer(text: string, cursor: number): string {
  const before = text.slice(0, cursor);
  const current = text[cursor] ?? " ";
  const after = text.slice(cursor + (text[cursor] ? 1 : 0));
  return `${before}\u001b[7m${current}\u001b[0m${after}`;
}

interface InputPromptProps {
  composer: ReturnTypeUseComposerState;
  slash: ReturnTypeUseSlashCommands;
  dialogsOpen: boolean;
}

export function InputPrompt({ composer, slash, dialogsOpen }: InputPromptProps) {
  const actions = useUIActions();
  const { running } = useUIState();
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);

  useEffect(() => {
    setSelectedSlashIndex((current) => Math.min(current, Math.max(composer.slashMatches.length - 1, 0)));
  }, [composer.slashMatches.length]);

  const slashVisible = !dialogsOpen && composer.slashMatches.length > 0;

  const handleKeypress = useCallback((input: string, key: RawKey) => {
    if (dialogsOpen) {
      return;
    }

    if (key.ctrl && input === "c") {
      void actions.handleInterrupt({
        hasInput: composer.buffer.hasText,
        clearInput: () => composer.clear()
      });
      return;
    }

    if (key.escape) {
      if (slashVisible) {
        actions.clearInterruptArming();
        composer.clear();
        return;
      }
      actions.closeTopDialog();
      return;
    }

    if (key.leftArrow) {
      actions.clearInterruptArming();
      composer.moveLeft();
      return;
    }
    if (key.rightArrow) {
      actions.clearInterruptArming();
      composer.moveRight();
      return;
    }
    if (key.upArrow) {
      actions.clearInterruptArming();
      if (slashVisible) {
        setSelectedSlashIndex((current) => Math.max(0, current - 1));
        return;
      }
      composer.historyUp();
      return;
    }
    if (key.downArrow) {
      actions.clearInterruptArming();
      if (slashVisible) {
        setSelectedSlashIndex((current) => Math.min(Math.max(composer.slashMatches.length - 1, 0), current + 1));
        return;
      }
      composer.historyDown();
      return;
    }
    if ((key.ctrl && key.name === "j") || (key.shift && key.return)) {
      actions.clearInterruptArming();
      composer.insert("\n");
      return;
    }
    if (key.return) {
      const prompt = composer.buffer.text.trim();
      if (!prompt) {
        return;
      }

      if (slashVisible) {
        const selected = composer.slashMatches[selectedSlashIndex]?.command.fullName ?? composer.buffer.text;
        if (selected.startsWith("/") && !composer.parsedSlashInput?.argsText) {
          void slash.execute(selected);
          composer.clear();
          return;
        }
      }

      void (async () => {
        const handled = await slash.execute(composer.buffer.text);
        if (handled) {
          composer.clear();
          return;
        }
        composer.recordHistory(composer.buffer.text);
        const raw = composer.buffer.text;
        composer.clear();
        await actions.submitPrompt(raw);
      })();
      return;
    }
    if (isBackwardDeleteInput(input, key)) {
      actions.clearInterruptArming();
      composer.deleteBackward();
      return;
    }
    if (isForwardDeleteInput(input, key)) {
      actions.clearInterruptArming();
      composer.deleteForward();
      return;
    }
    if (key.ctrl && input === "a") {
      actions.clearInterruptArming();
      composer.moveHome();
      return;
    }
    if (key.ctrl && input === "e") {
      actions.clearInterruptArming();
      composer.moveEnd();
      return;
    }
    if (isInsertableInput(input, key)) {
      actions.clearInterruptArming();
      composer.insert(input);
    }
  }, [actions, composer, dialogsOpen, selectedSlashIndex, slash, slashVisible]);

  useRawKeypress(handleKeypress, { isActive: !dialogsOpen });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={running ? "cyan" : "gray"} paddingX={1}>
      <Text dimColor>{running ? "task running" : "ready"} · Enter submit · Ctrl+J newline · Ctrl+C interrupt · double Ctrl+C exit</Text>
      <Text>{renderBuffer(composer.buffer.text, composer.buffer.cursor)}</Text>
      <Text dimColor>width:{stringWidth(composer.buffer.text)}</Text>
      {slashVisible ? (
        <Box flexDirection="column" marginTop={1}>
          {composer.slashMatches.slice(0, 6).map((match, index) => (
            <Text key={match.command.fullName} color={index === selectedSlashIndex ? "cyan" : undefined}>
              {index === selectedSlashIndex ? "› " : "  "}
              {match.command.fullName} {match.command.description}
            </Text>
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
