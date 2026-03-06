import { useMemo, useState } from "react";
import { InputBuffer } from "../input-buffer.js";
import { isSlashInput, parseSlashInput } from "../slash/parser.js";
import { SlashCommandRegistry } from "../slash/registry.js";

export function useComposerState(registry: SlashCommandRegistry) {
  const [buffer] = useState(() => new InputBuffer());
  const [, forceUpdate] = useState(0);

  const parsedSlashInput = useMemo(() => parseSlashInput(buffer.text), [buffer.text]);
  const slashMatches = useMemo(
    () => (isSlashInput(buffer.text) ? registry.search(parsedSlashInput?.commandToken ?? buffer.text) : []),
    [buffer.text, parsedSlashInput?.commandToken, registry]
  );

  function refresh(): void {
    forceUpdate((value) => value + 1);
  }

  return {
    buffer,
    parsedSlashInput,
    slashMatches,
    insert: (text: string) => {
      buffer.insert(text);
      refresh();
    },
    replace: (text: string) => {
      buffer.replace(text);
      refresh();
    },
    clear: () => {
      buffer.clear();
      refresh();
    },
    moveLeft: () => {
      buffer.moveLeft();
      refresh();
    },
    moveRight: () => {
      buffer.moveRight();
      refresh();
    },
    moveHome: () => {
      buffer.moveHome();
      refresh();
    },
    moveEnd: () => {
      buffer.moveEnd();
      refresh();
    },
    deleteBackward: () => {
      buffer.deleteBackward();
      refresh();
    },
    deleteForward: () => {
      buffer.deleteForward();
      refresh();
    },
    historyUp: () => {
      const next = buffer.navigateHistory("up");
      if (next !== null) {
        buffer.replace(next);
        refresh();
      }
    },
    historyDown: () => {
      const next = buffer.navigateHistory("down");
      if (next !== null) {
        buffer.replace(next);
        refresh();
      }
    },
    recordHistory: (prompt: string) => {
      buffer.recordHistory(prompt);
      refresh();
    }
  };
}
