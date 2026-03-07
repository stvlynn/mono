import { Box, Text } from "ink";
import { useAppContext } from "../contexts/AppContext.js";
import { useUIState } from "../contexts/UIStateContext.js";

export function AppHeader() {
  const { version } = useAppContext();
  const { status, waitingCopy, interrupt } = useUIState();
  return (
    <Box justifyContent="space-between">
      <Text color="cyan" bold>
        mono
      </Text>
      <Text dimColor>{version}</Text>
      <Text dimColor>{interrupt.hint ?? waitingCopy?.message ?? status}</Text>
    </Box>
  );
}
