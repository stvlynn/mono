import { Box } from "ink";
import type { ReturnTypeUseComposerState } from "../hooks/useComposerState.types.js";
import type { ReturnTypeUseSlashCommands } from "../hooks/useSlashCommands.types.js";
import { TodoTray } from "./TodoTray.js";
import { StatusDisplay } from "./StatusDisplay.js";
import { ContextUsageDisplay } from "./ContextUsageDisplay.js";
import { ToastDisplay } from "./ToastDisplay.js";
import { Footer } from "./Footer.js";
import { InputPrompt } from "./InputPrompt.js";

interface ComposerProps {
  composer: ReturnTypeUseComposerState;
  slash: ReturnTypeUseSlashCommands;
  dialogsOpen: boolean;
}

export function Composer({ composer, slash, dialogsOpen }: ComposerProps) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <TodoTray />
      <StatusDisplay />
      <ContextUsageDisplay />
      <ToastDisplay />
      <InputPrompt composer={composer} slash={slash} dialogsOpen={dialogsOpen} />
      <Footer />
    </Box>
  );
}
