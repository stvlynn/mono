import { Box, Text, useInput } from "ink";
import { useMemo, useState } from "react";
import type { ListDialog as ListDialogType } from "../types/ui.js";
import { fuzzyScore } from "../slash/fuzzy.js";
import { useUIActions } from "../contexts/UIActionsContext.js";

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

  useInput((input, key) => {
    if (key.escape) {
      actions.closeTopDialog();
      return;
    }
    if (key.return) {
      const selected = filteredItems[selectedIndex];
      if (selected) {
        void dialog.onSelect(selected.value);
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
    if (key.backspace || key.delete) {
      setQuery((value) => value.slice(0, -1));
      setSelectedIndex(0);
      return;
    }
    if (!key.ctrl && !key.meta && input) {
      setQuery((value) => `${value}${input}`);
      setSelectedIndex(0);
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
      <Text bold>{dialog.title}</Text>
      <Text dimColor>{dialog.hint ?? "Type to filter, Enter select, Esc close"}</Text>
      <Text>filter: {query || "<all>"}</Text>
      <Box flexDirection="column" marginTop={1}>
        {filteredItems.slice(0, 12).map((item, index) => (
          <Box key={item.value} flexDirection="column" marginBottom={1}>
            <Text color={index === selectedIndex ? "cyan" : undefined}>
              {index === selectedIndex ? "› " : "  "}
              {item.label}
            </Text>
            {item.description ? <Text dimColor>{item.description}</Text> : null}
          </Box>
        ))}
        {filteredItems.length === 0 ? <Text dimColor>No matching items</Text> : null}
      </Box>
    </Box>
  );
}
