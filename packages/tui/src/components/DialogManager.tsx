import { Box } from "ink";
import { useUIState } from "../contexts/UIStateContext.js";
import { ApprovalDialog } from "./ApprovalDialog.js";
import { HelpDialog } from "./HelpDialog.js";
import { InfoDialog } from "./InfoDialog.js";
import { ListDialog } from "./ListDialog.js";
import { SessionBrowser } from "./SessionBrowser.js";

export function DialogManager() {
  const { dialogs } = useUIState();
  const dialog = dialogs.at(-1);
  if (!dialog) {
    return null;
  }

  return (
    <Box marginTop={1}>
      {dialog.type === "help" ? <HelpDialog /> : null}
      {dialog.type === "info" ? <InfoDialog dialog={dialog} /> : null}
      {dialog.type === "approval" ? <ApprovalDialog dialog={dialog} /> : null}
      {dialog.type === "list" && dialog.kind === "session" ? <SessionBrowser dialog={dialog} /> : null}
      {dialog.type === "list" && dialog.kind !== "session" ? <ListDialog dialog={dialog} /> : null}
    </Box>
  );
}
