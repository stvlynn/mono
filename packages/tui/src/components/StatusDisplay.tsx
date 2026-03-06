import { Box, Text } from "ink";
import { useUIState } from "../contexts/UIStateContext.js";

export function StatusDisplay() {
  const { status, running, currentTask } = useUIState();
  return (
    <Box flexDirection="column">
      <Text color={running ? "cyan" : "gray"}>{status}</Text>
      {currentTask ? (
        <Text dimColor>
          phase={currentTask.phase} attempts={currentTask.attempts}
        </Text>
      ) : null}
    </Box>
  );
}
