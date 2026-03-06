import { Box, Text } from "ink";
import type { UIHistoryItem } from "../types/ui.js";
import { formatMessage } from "../ui-format.js";

export function HistoryItemDisplay({ item }: { item: UIHistoryItem }) {
  if (item.type === "system") {
    const color =
      item.tone === "error" ? "red" : item.tone === "warning" ? "yellow" : item.tone === "success" ? "green" : "gray";
    return (
      <Box marginBottom={1}>
        <Text color={color}>{item.text}</Text>
      </Box>
    );
  }

  return (
    <Box marginBottom={1}>
      <Text>{formatMessage(item.message)}</Text>
    </Box>
  );
}
