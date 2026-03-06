import { Box } from "ink";
import type { ReturnTypeUseComposerState } from "./hooks/useComposerState.types.js";
import type { ReturnTypeUseSlashCommands } from "./hooks/useSlashCommands.types.js";
import { MainContent } from "./components/MainContent.js";
import { Composer } from "./components/Composer.js";
import { DialogManager } from "./components/DialogManager.js";
import { useUIState } from "./contexts/UIStateContext.js";

interface RootAppProps {
  composer: ReturnTypeUseComposerState;
  slash: ReturnTypeUseSlashCommands;
}

export function RootApp({ composer, slash }: RootAppProps) {
  const { dialogs } = useUIState();

  return (
    <Box flexDirection="column">
      <MainContent />
      <Composer composer={composer} slash={slash} dialogsOpen={dialogs.length > 0} />
      <DialogManager />
    </Box>
  );
}
