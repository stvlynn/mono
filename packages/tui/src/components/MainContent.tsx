import { Box, Text } from "ink";
import { AppHeader } from "./AppHeader.js";
import { HistoryItemDisplay } from "./HistoryItemDisplay.js";
import { LoadingIndicator } from "./LoadingIndicator.js";
import { useUIState } from "../contexts/UIStateContext.js";

function PendingTools() {
  const { pendingTools } = useUIState();
  if (pendingTools.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginTop={1}>
      <Text bold color="yellow">
        Pending Tools
      </Text>
      {pendingTools.map((tool) => (
        <Box key={tool.callId} flexDirection="column" marginTop={1}>
          <Text>
            {tool.status === "running" ? "…" : tool.status === "done" ? "✓" : tool.status === "error" ? "x" : "-"} {tool.name}
          </Text>
          {tool.output ? <Text dimColor>{tool.output}</Text> : null}
        </Box>
      ))}
    </Box>
  );
}

function PendingAssistant() {
  const { pendingAssistant, running } = useUIState();
  if (!pendingAssistant && !running) {
    return null;
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginTop={1}>
      <Text bold color="cyan">
        Assistant
      </Text>
      {pendingAssistant?.thinking ? <Text dimColor>{pendingAssistant.thinking}</Text> : null}
      {pendingAssistant?.text ? <Text>{pendingAssistant.text}</Text> : <LoadingIndicator label="Working..." />}
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
