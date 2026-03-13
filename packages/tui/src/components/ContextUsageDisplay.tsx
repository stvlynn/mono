import { Text } from "ink";
import { useAppContext } from "../contexts/AppContext.js";
import { useUIState } from "../contexts/UIStateContext.js";

export function ContextUsageDisplay() {
  const { agent } = useAppContext();
  const { history } = useUIState();
  const report = agent.getLatestContextReport();
  if (!report) {
    return <Text dimColor>history:{history.length}</Text>;
  }
  return <Text dimColor>history:{history.length} ctx:~{report.estimatedTokens}tok</Text>;
}
