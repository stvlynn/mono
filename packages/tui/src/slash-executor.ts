import type { ParsedSlashInput, SlashCommandDefinition } from "./slash/types.js";

interface SlashCommandExecutorActions {
  exit: () => void;
  openHelp: () => void;
  openOnboarding: () => void;
  openProfileSelector: (filter?: string) => Promise<void>;
  openModelSelector: (filter?: string) => Promise<void>;
  openSessionSelector: (filter?: string) => Promise<void>;
  openTreeView: (filter?: string) => Promise<void>;
  clearInput: () => void;
  setUnknownCommand: (commandName: string) => void;
  isRunning: () => boolean;
  setBlockedSwitchStatus: () => void;
}

export function buildSlashCommandLine(command: SlashCommandDefinition, argsText = "", hasTrailingSpace = false): string {
  return `${command.fullName}${argsText ? ` ${argsText}` : hasTrailingSpace ? " " : ""}`;
}

export class SlashCommandExecutor {
  constructor(private readonly actions: SlashCommandExecutorActions) {}

  async execute(command: SlashCommandDefinition, parsed: ParsedSlashInput): Promise<void> {
    const filter = parsed.argsText || undefined;

    switch (command.name) {
      case "quit":
        this.actions.exit();
        return;
      case "help":
        this.actions.openHelp();
        this.actions.clearInput();
        return;
      case "auth":
        this.actions.openOnboarding();
        this.actions.clearInput();
        return;
      case "profile":
        if (this.actions.isRunning()) {
          this.actions.setBlockedSwitchStatus();
          return;
        }
        this.actions.clearInput();
        await this.actions.openProfileSelector(filter);
        return;
      case "model":
        if (this.actions.isRunning()) {
          this.actions.setBlockedSwitchStatus();
          return;
        }
        this.actions.clearInput();
        await this.actions.openModelSelector(filter);
        return;
      case "sessions":
        if (this.actions.isRunning()) {
          this.actions.setBlockedSwitchStatus();
          return;
        }
        this.actions.clearInput();
        await this.actions.openSessionSelector(filter);
        return;
      case "tree":
        if (this.actions.isRunning()) {
          this.actions.setBlockedSwitchStatus();
          return;
        }
        this.actions.clearInput();
        await this.actions.openTreeView(filter);
        return;
      default:
        this.actions.setUnknownCommand(command.fullName);
    }
  }
}
