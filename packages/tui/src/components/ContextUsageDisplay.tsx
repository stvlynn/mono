import { Text } from "ink";
import { useUIState } from "../contexts/UIStateContext.js";

export function ContextUsageDisplay() {
  const { history } = useUIState();
  return <Text dimColor>history:{history.length}</Text>;
}
