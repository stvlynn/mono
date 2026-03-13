import { Box, Text } from "ink";
import { AppHeader } from "./AppHeader.js";
import { HistoryItemDisplay } from "./HistoryItemDisplay.js";
import { LoadingIndicator } from "./LoadingIndicator.js";
import { useUIState } from "../contexts/UIStateContext.js";
import { useSettings } from "../contexts/SettingsContext.js";
import { MarkdownRenderer } from "./MarkdownRenderer.js";

function PendingTools() {
  const { pendingTools, waitingCopy } = useUIState();
  const { settings } = useSettings();
  if (pendingTools.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginTop={1}>
      <Text bold color="yellow">
        Pending Tools
      </Text>
      {waitingCopy?.kind === "tool_running" ? <Text dimColor>{waitingCopy.message}</Text> : null}
      {pendingTools.map((tool) => (
        <Box key={tool.callId} flexDirection="column" marginTop={1}>
          <Text>
            {tool.status === "running" ? "…" : tool.status === "done" ? "✓" : tool.status === "error" ? "x" : "-"} {tool.name}
          </Text>
          <Text dimColor>{tool.summary}</Text>
          {settings.toolDetailsVisible && tool.detail ? <Text dimColor>{tool.detail}</Text> : null}
        </Box>
      ))}
    </Box>
  );
}

function PendingAssistant() {
  const { pendingAssistant, running } = useUIState();
  const { settings } = useSettings();
  if (!pendingAssistant && !running) {
    return null;
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginTop={1}>
      <Text bold color="cyan">
        Assistant
      </Text>
      {pendingAssistant?.thinking ? (
        settings.thinkingVisible ? <Text dimColor>{pendingAssistant.thinking}</Text> : <Text dimColor>Thinking hidden while streaming</Text>
      ) : null}
      {pendingAssistant?.text ? (
        <MarkdownRenderer content={pendingAssistant.text} enabled={settings.assistantMarkdownEnabled} />
      ) : (
        <LoadingIndicator />
      )}
    </Box>
  );
}

export function MainContent() {
  const { history } = useUIState();

  return (
    <Box flexDirection="column" flexGrow={1}>
      <AppHeader />
      <Box flexDirection="column" marginTop={1}>
        {history.length === 0 ? (
          <Text dimColor>No conversation yet.</Text>
        ) : (
          history.map((item) => <HistoryItemDisplay key={item.id} item={item} />)
        )}
      </Box>
      <PendingTools />
      <PendingAssistant />
    </Box>
  );
}
