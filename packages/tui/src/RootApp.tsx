import { Box } from "ink";
import type { InputImageAttachment } from "@mono/shared";
import type { ReturnTypeUseComposerState } from "./hooks/useComposerState.types.js";
import type { ReturnTypeUseSlashCommands } from "./hooks/useSlashCommands.types.js";
import { MainContent } from "./components/MainContent.js";
import { Composer } from "./components/Composer.js";
import { DialogManager } from "./components/DialogManager.js";
import { useUIState } from "./contexts/UIStateContext.js";

interface RootAppProps {
  composer: ReturnTypeUseComposerState;
  slash: ReturnTypeUseSlashCommands;
  attachments: InputImageAttachment[];
}

export function RootApp({ composer, slash, attachments }: RootAppProps) {
  const { dialogs } = useUIState();

  return (
    <Box flexDirection="column">
      <MainContent />
      <Composer composer={composer} slash={slash} dialogsOpen={dialogs.length > 0} attachments={attachments} />
      <DialogManager />
    </Box>
  );
}
