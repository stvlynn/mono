import { Box, Text } from "ink";

export function HelpDialog() {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
      <Text bold>Commands</Text>
      <Text>/help /model /profile /sessions /tree /memory /settings /quit</Text>
      <Text dimColor>Enter submit · Ctrl+J newline · Esc close dialog · Ctrl+C interrupt · double Ctrl+C exit</Text>
    </Box>
  );
}
