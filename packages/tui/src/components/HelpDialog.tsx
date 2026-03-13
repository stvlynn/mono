import { Box, Text } from "ink";
import { useCallback } from "react";
import { useForegroundKeypress } from "../contexts/ForegroundKeypressContext.js";
import { useUIActions } from "../contexts/UIActionsContext.js";
import type { RawKey } from "../hooks/useRawKeypress.js";

export function HelpDialog() {
  const actions = useUIActions();

  const handleKeypress = useCallback((input: string, key: RawKey) => {
    if (key.ctrl && key.name === "c") {
      void actions.handleInterrupt();
      return;
    }

    if (key.escape || key.return || input === "q") {
      actions.closeTopDialog();
    }
  }, [actions]);

  useForegroundKeypress(handleKeypress);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" padding={1}>
      <Text bold>Commands</Text>
      <Text>/help /pair /telegram /model /profile /sessions /skills /context /tree /memory /attach /detach /attachments /settings /thinking /markdown /tools /quit</Text>
      <Text bold>Telegram Pairing</Text>
      <Text>1. Configure token: `mono telegram token &lt;BOT_TOKEN&gt;`</Text>
      <Text>2. Keep mono TUI open so Telegram polling is active</Text>
      <Text>3. Unknown Telegram DMs receive a pairing code</Text>
      <Text>4. Approve in-platform: `/pair telegram code &lt;CODE&gt;`</Text>
      <Text>5. Shortcuts: `/pair telegram userid &lt;USER_ID&gt;` and `/pair telegram botid &lt;BOT_ID&gt;`</Text>
      <Text dimColor>Use `/telegram status` to inspect the token, policy, pending requests, and allowlist store.</Text>
      <Text dimColor>Enter submit · PgUp/PgDn browse messages · Home/End jump history · Up/Down query history · Ctrl+J newline</Text>
      <Text dimColor>Esc close dialog · Ctrl+C interrupt · double Ctrl+C exit</Text>
    </Box>
  );
}
