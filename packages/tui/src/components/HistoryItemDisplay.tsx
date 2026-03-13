import { Box, Text } from "ink";
import type { UIHistoryItem } from "../types/ui.js";
import { ConversationMessageDisplay } from "./ConversationMessageDisplay.js";

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
    <ConversationMessageDisplay message={item.message} />
  );
}
