import { Box, Text } from "ink";
import { useCallback, useMemo, useState } from "react";
import type { ListDialog as ListDialogType } from "../types/ui.js";
import { useForegroundKeypress } from "../contexts/ForegroundKeypressContext.js";
import { fuzzyScore } from "../slash/fuzzy.js";
import { useUIActions } from "../contexts/UIActionsContext.js";
import { isBackwardDeleteInput, isForwardDeleteInput } from "../input-keys.js";
import { isInsertableInput, type RawKey } from "../hooks/useRawKeypress.js";

const MAX_VISIBLE_ITEMS = 12;

export function getVisibleListWindow(selectedIndex: number, totalItems: number, windowSize = MAX_VISIBLE_ITEMS): {
  start: number;
  end: number;
} {
  const safeWindowSize = Math.max(windowSize, 1);
  const maxStart = Math.max(totalItems - safeWindowSize, 0);
  const start = Math.max(0, Math.min(Math.max(selectedIndex - safeWindowSize + 1, 0), maxStart));
  return {
    start,
    end: start + safeWindowSize
  };
}

export function ListDialog({ dialog }: { dialog: ListDialogType }) {
  const actions = useUIActions();
  const [query, setQuery] = useState(dialog.initialFilter ?? "");
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filteredItems = useMemo(() => {
    if (!query.trim()) {
      return dialog.items;
    }
    return dialog.items
      .map((item) => ({ item, match: fuzzyScore(query, `${item.label} ${item.description ?? ""}`) }))
      .filter((entry) => entry.match)
      .sort((left, right) => (right.match?.score ?? 0) - (left.match?.score ?? 0))
      .map((entry) => entry.item);
  }, [dialog.items, query]);
  const visibleWindow = useMemo(
    () => getVisibleListWindow(selectedIndex, filteredItems.length),
    [filteredItems.length, selectedIndex]
  );
  const visibleItems = useMemo(
    () => filteredItems.slice(visibleWindow.start, visibleWindow.end),
    [filteredItems, visibleWindow.end, visibleWindow.start]
  );

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
      const selected = filteredItems[selectedIndex];
      if (selected) {
        void (async () => {
          try {
            await dialog.onSelect(selected.value);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error || "Failed to apply selection");
            actions.setStatus(message && message !== "undefined" ? message : "Failed to apply selection");
          }
        })();
      }
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((value) => Math.max(0, value - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((value) => Math.min(Math.max(filteredItems.length - 1, 0), value + 1));
      return;
    }
    if (isBackwardDeleteInput(input, key) || isForwardDeleteInput(input, key)) {
      setQuery((value) => value.slice(0, -1));
      setSelectedIndex(0);
      return;
    }
    if (isInsertableInput(input, key)) {
      setQuery((value) => `${value}${input}`);
      setSelectedIndex(0);
    }
  }, [actions, dialog, filteredItems, selectedIndex]);

  useForegroundKeypress(handleKeypress);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
      <Text bold>{dialog.title}</Text>
      <Text dimColor>{dialog.hint ?? "Type to filter, Enter select, Esc close"}</Text>
      <Text>filter: {query || "<all>"}</Text>
      <Box flexDirection="column" marginTop={1}>
        {visibleItems.map((item, index) => {
          const absoluteIndex = visibleWindow.start + index;

          return (
          <Box key={item.value} flexDirection="column" marginBottom={1}>
            <Text color={absoluteIndex === selectedIndex ? "cyan" : undefined}>
              {absoluteIndex === selectedIndex ? "› " : "  "}
              {item.label}
            </Text>
            {item.description ? <Text dimColor>{item.description}</Text> : null}
          </Box>
          );
        })}
        {filteredItems.length === 0 ? <Text dimColor>No matching items</Text> : null}
      </Box>
    </Box>
  );
}
