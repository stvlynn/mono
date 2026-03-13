import { Box, Text } from "ink";
import { useCallback, useEffect, useState } from "react";
import stringWidth from "string-width";
import type { InputImageAttachment } from "@mono/shared";
import type { ReturnTypeUseComposerState } from "../hooks/useComposerState.types.js";
import type { ReturnTypeUseSlashCommands } from "../hooks/useSlashCommands.types.js";
import { useForegroundKeypress } from "../contexts/ForegroundKeypressContext.js";
import { useSettings } from "../contexts/SettingsContext.js";
import { useUIActions } from "../contexts/UIActionsContext.js";
import { useUIState } from "../contexts/UIStateContext.js";
import { isBackwardDeleteInput, isForwardDeleteInput } from "../input-keys.js";
import { isInsertableInput, type RawKey } from "../hooks/useRawKeypress.js";

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
  attachments: InputImageAttachment[];
}

function formatAttachmentLine(attachment: InputImageAttachment, index: number): string {
  const label = attachment.sourceLabel ?? `image-${index + 1}`;
  return `${index + 1}. ${label} (${attachment.mimeType})`;
}

export function InputPrompt({ composer, slash, dialogsOpen, attachments }: InputPromptProps) {
  const actions = useUIActions();
  const { settings } = useSettings();
  const { running, isExiting, historyScrollOffset } = useUIState();
  const [selectedSlashIndex, setSelectedSlashIndex] = useState(0);

  useEffect(() => {
    setSelectedSlashIndex((current) => Math.min(current, Math.max(composer.slashMatches.length - 1, 0)));
  }, [composer.slashMatches.length]);

  const slashVisible = !dialogsOpen && composer.slashMatches.length > 0;
  const inputIsEmpty = composer.buffer.text.trim().length === 0;
  const handleAsyncError = useCallback((error: unknown, fallback: string) => {
    const message = error instanceof Error ? error.message : String(error || fallback);
    actions.setStatus(message && message !== "undefined" ? message : fallback);
  }, [actions]);

  const handleKeypress = useCallback((input: string, key: RawKey) => {
    if (key.ctrl && key.name === "c") {
      void actions.handleInterrupt();
      return;
    }

    if (dialogsOpen || isExiting) {
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
    if (settings.alternateBuffer && key.wheelUp) {
      actions.clearInterruptArming();
      actions.scrollHistoryLineUp();
      return;
    }
    if (settings.alternateBuffer && key.wheelDown) {
      actions.clearInterruptArming();
      actions.scrollHistoryLineDown();
      return;
    }
    if (settings.alternateBuffer && (key.pageUp || (key.ctrl && key.name === "u"))) {
      actions.clearInterruptArming();
      actions.scrollHistoryPageUp();
      return;
    }
    if (settings.alternateBuffer && (key.pageDown || (key.ctrl && key.name === "d"))) {
      actions.clearInterruptArming();
      actions.scrollHistoryPageDown();
      return;
    }
    if (settings.alternateBuffer && key.home && inputIsEmpty) {
      actions.clearInterruptArming();
      actions.scrollHistoryToTop();
      return;
    }
    if (settings.alternateBuffer && key.end && inputIsEmpty) {
      actions.clearInterruptArming();
      actions.scrollHistoryToBottom();
      return;
    }
    if (key.upArrow) {
      actions.clearInterruptArming();
      if (slashVisible) {
        setSelectedSlashIndex((current) => Math.max(0, current - 1));
        return;
      }
      if (settings.alternateBuffer && inputIsEmpty && historyScrollOffset > 0) {
        actions.scrollHistoryLineUp();
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
      if (settings.alternateBuffer && inputIsEmpty && historyScrollOffset > 0) {
        actions.scrollHistoryLineDown();
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
      if (!prompt && attachments.length === 0) {
        return;
      }

      if (slashVisible) {
        const selected = composer.slashMatches[selectedSlashIndex]?.command.fullName ?? composer.buffer.text;
        if (selected.startsWith("/") && !composer.parsedSlashInput?.argsText) {
          void (async () => {
            try {
              await slash.execute(selected);
            } catch (error) {
              handleAsyncError(error, `Failed to execute ${selected}`);
            } finally {
              composer.clear();
            }
          })();
          return;
        }
      }

      void (async () => {
        try {
          const handled = await slash.execute(composer.buffer.text);
          if (handled) {
            composer.clear();
            return;
          }
          const raw = composer.buffer.text;
          if (raw.trim()) {
            composer.recordHistory(raw);
          }
          composer.clear();
          await actions.submitPrompt(raw);
        } catch (error) {
          handleAsyncError(error, "Failed to process prompt");
        }
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
    if (key.ctrl && key.name === "a") {
      actions.clearInterruptArming();
      composer.moveHome();
      return;
    }
    if (key.ctrl && key.name === "e") {
      actions.clearInterruptArming();
      composer.moveEnd();
      return;
    }
    if (isInsertableInput(input, key)) {
      actions.clearInterruptArming();
      composer.insert(input);
    }
  }, [actions, composer, dialogsOpen, handleAsyncError, historyScrollOffset, inputIsEmpty, isExiting, selectedSlashIndex, settings.alternateBuffer, slash, slashVisible]);

  useForegroundKeypress(handleKeypress, !dialogsOpen || isExiting);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={running ? "cyan" : "gray"} paddingX={1}>
      <Text dimColor>
        {isExiting ? "exiting" : running ? "task running" : "ready"} · Enter submit · {settings.alternateBuffer ? "PgUp/PgDn browse" : "terminal scrollback enabled"} · Ctrl+J newline · /attach path/to.png · Ctrl+C interrupt · double Ctrl+C exit
      </Text>
      {attachments.length > 0 ? (
        <Box flexDirection="column">
          <Text color="yellow">attachments: {attachments.length}</Text>
          {attachments.slice(0, 3).map((attachment, index) => (
            <Text key={`${attachment.sourceLabel ?? attachment.mimeType}-${index}`}>{formatAttachmentLine(attachment, index)}</Text>
          ))}
          {attachments.length > 3 ? <Text dimColor>...and {attachments.length - 3} more</Text> : null}
        </Box>
      ) : null}
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
