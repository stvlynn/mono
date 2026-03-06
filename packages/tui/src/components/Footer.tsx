import { Box, Text } from "ink";
import { useAppContext } from "../contexts/AppContext.js";
import { useSettings } from "../contexts/SettingsContext.js";
import { useUIState } from "../contexts/UIStateContext.js";

export function Footer() {
  const { agent } = useAppContext();
  const { settings } = useSettings();
  const { initialized } = useUIState();
  if (!settings.footerVisible) {
    return null;
  }

  if (!initialized) {
    return (
      <Box justifyContent="space-between">
        <Text dimColor>profile:loading model:loading</Text>
        <Text dimColor>session:loading task:idle</Text>
      </Box>
    );
  }

  const model = agent.getCurrentModel();
  return (
    <Box justifyContent="space-between">
      <Text dimColor>
        profile:{agent.getProfileName()} model:{model.provider}/{model.modelId}
      </Text>
      <Text dimColor>
        session:{agent.getSessionId().slice(0, 8)} task:{agent.getCurrentTask()?.phase ?? "idle"}
      </Text>
    </Box>
  );
}
