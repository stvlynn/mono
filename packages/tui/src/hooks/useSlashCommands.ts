import { useMemo } from "react";
import { SlashCommandRegistry } from "../slash/registry.js";
import { parseSlashInput } from "../slash/parser.js";
import type { UIActions } from "../contexts/UIActionsContext.js";

export function useSlashCommands(actions: UIActions) {
  const registry = useMemo(() => new SlashCommandRegistry(), []);

  async function execute(raw: string): Promise<boolean> {
    const parsed = parseSlashInput(raw);
    if (!parsed) {
      return false;
    }

    const command = registry.find(parsed.commandName);
    if (!command) {
      actions.setStatus(`Unknown command: ${parsed.commandToken}`);
      return true;
    }

    switch (command.name) {
      case "help":
        actions.openHelp();
        return true;
      case "profile":
        await actions.openProfileDialog(parsed.argsText || undefined);
        return true;
      case "model":
        await actions.openModelDialog(parsed.argsText || undefined);
        return true;
      case "auth":
        actions.openAuthInfo();
        return true;
      case "sessions":
        await actions.openSessionDialog(parsed.argsText || undefined);
        return true;
      case "memory":
        await actions.openMemoryDialog(parsed.argsText || undefined);
        return true;
      case "tree":
        await actions.openTreeDialog(parsed.argsText || undefined);
        return true;
      case "quit":
        actions.exitApp();
        return true;
      case "settings":
        actions.openSettings();
        return true;
      case "resume":
        await actions.openSessionDialog(parsed.argsText || undefined);
        return true;
      case "clear":
        actions.setStatus("Clear is not implemented yet.");
        return true;
      case "theme":
        actions.openSettings();
        return true;
      default:
        actions.setStatus(`Command not implemented: ${command.fullName}`);
        return true;
    }
  }

  return {
    registry,
    execute
  };
}
