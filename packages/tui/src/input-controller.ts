import { parseKey } from "@mono/pi-tui";
import type { ParsedSlashInput, SlashCommandDefinition } from "./slash/types.js";

interface InputControllerActions {
  isStopped: () => boolean;
  isBracketedPaste: (data: string) => boolean;
  insertText: (text: string) => void;
  handleApprovalInput: (key: string) => boolean;
  handlePassiveModalInput: (key: string) => boolean;
  handleSelectorInput: (data: string) => boolean;
  handleGlobalShortcut: (key: string) => Promise<boolean>;
  handleEscapeKey: () => Promise<boolean>;
  handleSlashNavigation: (key: string, data: string) => boolean;
  isRunning: () => boolean;
  isSlashContext: () => boolean;
  isSlashPaletteVisible: () => boolean;
  getParsedSlashInput: () => ParsedSlashInput | null;
  selectedSlashCommand: () => SlashCommandDefinition | undefined;
  applySlashSelection: (command: SlashCommandDefinition, argsText?: string, hasTrailingSpace?: boolean) => Promise<void>;
  executeSlashInput: (commandLine: string) => Promise<void>;
  getInputText: () => string;
  submitPrompt: (prompt: string) => Promise<void>;
  handleCursorKey: (key: string) => boolean;
  handleDeletionKey: (key: string) => boolean;
  handleHistoryKey: (key: string) => boolean;
}

export class InputController {
  constructor(private readonly actions: InputControllerActions) {}

  async handle(data: string): Promise<void> {
    if (this.actions.isStopped()) {
      return;
    }

    if (this.actions.isBracketedPaste(data)) {
      this.actions.insertText(data.slice(6, -6));
      return;
    }

    const key = parseKey(data);

    if (this.actions.handleApprovalInput(key)) {
      return;
    }

    if (this.actions.handlePassiveModalInput(key)) {
      return;
    }

    if (this.actions.handleSelectorInput(data)) {
      return;
    }

    if (await this.actions.handleGlobalShortcut(key)) {
      return;
    }

    if (key === "escape") {
      await this.actions.handleEscapeKey();
      return;
    }

    if (this.actions.handleSlashNavigation(key, data)) {
      return;
    }

    if (key === "enter") {
      await this.handleEnterKey();
      return;
    }

    if (this.actions.handleCursorKey(key)) {
      return;
    }

    if (this.actions.handleDeletionKey(key)) {
      return;
    }

    if (this.actions.handleHistoryKey(key)) {
      return;
    }

    if (!data.startsWith("\u001b") && key !== "tab") {
      this.actions.insertText(data);
    }
  }

  private async handleEnterKey(): Promise<void> {
    if (this.actions.isSlashContext()) {
      if (this.actions.isSlashPaletteVisible()) {
        const parsed = this.actions.getParsedSlashInput();
        const command = this.actions.selectedSlashCommand();
        if (command) {
          await this.actions.applySlashSelection(command, parsed?.argsText ?? "", parsed?.hasTrailingSpace ?? false);
          return;
        }
      }

      await this.actions.executeSlashInput(this.actions.getInputText());
      return;
    }

    if (this.actions.isRunning()) {
      return;
    }

    await this.actions.submitPrompt(this.actions.getInputText());
  }
}
