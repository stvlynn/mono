import { Box, Text } from "ink";
import type { InfoDialog as InfoDialogType } from "../types/ui.js";

export function InfoDialog({ dialog }: { dialog: InfoDialogType }) {
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
