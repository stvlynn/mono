import type { Agent } from "@mono/agent-core";
import { ProcessTerminal, type SelectItem, TUI, padRight, truncateToWidth } from "@mono/pi-tui";
import type { ConversationMessage } from "@mono/shared";
import { AgentEventCoordinator } from "./agent-event-coordinator.js";
import { InputBuffer } from "./input-buffer.js";
import { InputController } from "./input-controller.js";
import { parseSlashInput, isSlashInput } from "./slash/parser.js";
import { SlashCommandRegistry } from "./slash/registry.js";
import type { ParsedSlashInput, SlashCommandDefinition, SlashCommandMatch } from "./slash/types.js";
import { ansi, createSelectList, toSelectItems } from "./ui-format.js";
import { renderConversationSection, renderEditorSection, renderModal, renderTaskSection, renderToolsSection } from "./render-sections.js";
import { createSelectorModal } from "./selector-modal.js";
import { SelectorCoordinator } from "./selector-coordinator.js";
import { buildSlashCommandLine, SlashCommandExecutor } from "./slash-executor.js";
import type { ModalState, ToolRun } from "./ui-types.js";

interface InteractiveAppProps {
  agent: Agent;
  initialPrompt?: string;
}

class MonoInteractiveApp {
  private readonly tui = new TUI(new ProcessTerminal());
  private readonly messages: ConversationMessage[] = [];
  private readonly toolRuns: ToolRun[] = [];
  private readonly input = new InputBuffer();
  private readonly unsubscribe: (() => void)[] = [];
  private readonly slashRegistry = new SlashCommandRegistry();
  private readonly slashList = createSelectList([], "  No matching commands");
  private readonly selectorCoordinator: SelectorCoordinator;
  private readonly slashExecutor: SlashCommandExecutor;
  private readonly eventCoordinator: AgentEventCoordinator;
  private readonly inputController: InputController;
  private slashMatches: SlashCommandMatch[] = [];
  private slashPaletteSuppressed = false;
  private modal: ModalState = { type: "none" };
  private status = "Starting...";
  private running = false;
  private streamingText = "";
  private streamingThinking = "";
  private approvalResolver: ((approved: boolean) => void) | null = null;
  private submittedInitialPrompt = false;
  private lastEscapeAt = 0;
  private initialized = false;
  private resolveExit?: () => void;
  private stopped = false;

  constructor(private readonly options: InteractiveAppProps) {
    this.selectorCoordinator = new SelectorCoordinator(this.options.agent, {
      openSelectorModal: (options) => {
        this.openSelectorModal(options);
      },
      closeModal: () => {
        this.modal = { type: "none" };
      },
      setStatus: (status) => {
        this.status = status;
      },
      openDetailsModal: (title, lines) => {
        this.modal = { type: "details", title, lines };
      },
      clearInput: () => {
        this.clearInput();
      },
      replaceMessages: (messages) => {
        this.messages.splice(0, this.messages.length, ...messages);
      },
      requestRender: () => {
        this.requestRender();
      }
    });
    this.slashExecutor = new SlashCommandExecutor({
      exit: () => {
        this.exit();
      },
      openHelp: () => {
        this.modal = { type: "help" };
      },
      openOnboarding: () => {
        this.modal = { type: "onboarding" };
      },
      openProfileSelector: async (filter) => this.selectorCoordinator.openProfileSelector(filter),
      openModelSelector: async (filter) => this.selectorCoordinator.openModelSelector(filter),
      openSessionSelector: async (filter) => this.selectorCoordinator.openSessionSelector(filter),
      openMemorySelector: async (filter) => this.selectorCoordinator.openMemorySelector(filter),
      openTreeView: async (filter) => this.selectorCoordinator.openTreeView(filter),
      clearInput: () => {
        this.clearInput();
      },
      setUnknownCommand: (commandName) => {
        this.status = `Unknown command: ${commandName}`;
        this.requestRender();
      },
      isRunning: () => this.isRunActive(),
      setBlockedSwitchStatus: () => {
        this.setSwitchBlockedStatus();
      }
    });
    this.eventCoordinator = new AgentEventCoordinator({
      setRunning: (running) => {
        this.running = running;
      },
      setStatus: (status) => {
        this.status = status;
      },
      setStreamingText: (value) => {
        this.streamingText = value;
      },
      appendStreamingText: (value) => {
        this.streamingText += value;
      },
      setStreamingThinking: (value) => {
        this.streamingThinking = value;
      },
      appendStreamingThinking: (value) => {
        this.streamingThinking += value;
      },
      upsertToolRun: (toolRun) => {
        this.upsertToolRun(toolRun);
      },
      openApprovalModal: (request) => {
        this.modal = { type: "approval", request };
      },
      pushMessage: (message) => {
        this.messages.push(message);
      },
      requestRender: () => {
        this.requestRender();
      }
    });
    this.inputController = new InputController({
      isStopped: () => this.stopped,
      isBracketedPaste: (data) => this.isBracketedPaste(data),
      insertText: (text) => this.insertText(text),
      handleApprovalInput: (key) => this.handleApprovalInput(key),
      handlePassiveModalInput: (key) => this.handlePassiveModalInput(key),
      handleSelectorInput: (data) => this.handleSelectorInput(data),
      handleGlobalShortcut: async (key) => this.handleGlobalShortcut(key),
      handleEscapeKey: async () => this.handleEscapeKey(),
      handleSlashNavigation: (key, data) => this.handleSlashNavigation(key, data),
      isRunning: () => this.running,
      isSlashContext: () => this.isSlashContext(),
      isSlashPaletteVisible: () => this.isSlashPaletteVisible(),
      getParsedSlashInput: () => this.getParsedSlashInput(),
      selectedSlashCommand: () => this.selectedSlashCommand(),
      applySlashSelection: async (command, argsText, hasTrailingSpace) => this.applySlashSelection(command, argsText, hasTrailingSpace),
      executeSlashInput: async (commandLine) => this.executeSlashInput(commandLine),
      getInputText: () => this.input.text,
      submitPrompt: async (prompt) => this.submitPrompt(prompt),
      handleCursorKey: (key) => this.handleCursorKey(key),
      handleDeletionKey: (key) => this.handleDeletionKey(key),
      handleHistoryKey: (key) => this.handleHistoryKey(key)
    });
    this.slashList.onSelect = (item: SelectItem) => {
      const command = this.slashRegistry.find(item.value);
      if (command) {
        const parsed = parseSlashInput(this.input.text);
        void this.applySlashSelection(command, parsed?.argsText ?? "", parsed?.hasTrailingSpace ?? false);
      }
    };
    this.slashList.onCancel = () => {
      this.slashPaletteSuppressed = true;
      this.requestRender();
    };
    this.refreshSlashPalette();
    this.tui.addChild({
      render: (width: number, height: number) => this.render(width, height),
      handleInput: (data: string) => {
        void this.inputController.handle(data);
      }
    });
  }

  async run(): Promise<void> {
    this.tui.start();
    const completion = new Promise<void>((resolve) => {
      this.resolveExit = resolve;
    });

    try {
      await this.initialize();
      await completion;
    } finally {
      this.stop();
    }
  }

  private async initialize(): Promise<void> {
    const unsubscribe = this.options.agent.subscribe((event) => {
      this.eventCoordinator.handle(event);
    });

    this.unsubscribe.push(unsubscribe);

    this.options.agent.setRequestApproval(
      (request) =>
        new Promise<boolean>((resolve) => {
          this.approvalResolver = resolve;
          this.modal = { type: "approval", request };
          this.requestRender();
        })
    );

    await this.options.agent.initialize();
    this.initialized = true;
    this.eventCoordinator.applyInitialState(this.options.agent.getMessages(), this.options.agent.getConfigSummary().hasAnyProfiles);
    if (!this.options.agent.getConfigSummary().hasAnyProfiles) {
      this.modal = { type: "onboarding" };
      this.requestRender();
    }

    if (this.options.initialPrompt && !this.submittedInitialPrompt) {
      this.submittedInitialPrompt = true;
      await this.submitPrompt(this.options.initialPrompt);
    }
  }

  private stop(): void {
    if (this.stopped) {
      return;
    }
    this.stopped = true;
    for (const unsubscribe of this.unsubscribe) {
      unsubscribe();
    }
    this.unsubscribe.length = 0;
    this.tui.stop();
  }

  private exit(): void {
    this.resolveExit?.();
  }

  private isRunActive(): boolean {
    return this.running || this.options.agent.isRunning();
  }

  private setSwitchBlockedStatus(): void {
    this.status = "Cannot switch profile, model, or session while a run is active";
    this.requestRender();
  }

  private cancelPendingApproval(): void {
    if (this.approvalResolver) {
      this.approvalResolver(false);
      this.approvalResolver = null;
    }
    if (this.modal.type === "approval") {
      this.modal = { type: "none" };
    }
  }

  private requestRender(): void {
    this.tui.requestRender();
  }

  private upsertToolRun(next: ToolRun): void {
    const index = this.toolRuns.findIndex((item) => item.id === next.id);
    if (index === -1) {
      this.toolRuns.unshift(next);
      return;
    }
    this.toolRuns[index] = next;
  }

  private getParsedSlashInput(): ParsedSlashInput | null {
    return parseSlashInput(this.input.text);
  }

  private isSlashContext(): boolean {
    return this.modal.type === "none" && isSlashInput(this.input.text.trimStart());
  }

  private isSlashPaletteVisible(): boolean {
    return this.isSlashContext() && !this.slashPaletteSuppressed;
  }

  private refreshSlashPalette(): void {
    const parsed = this.getParsedSlashInput();
    if (!parsed) {
      this.slashMatches = this.slashRegistry.search("");
      this.slashList.setItems(toSelectItems(this.slashMatches));
      this.slashPaletteSuppressed = false;
      return;
    }

    const matches = this.slashRegistry.search(parsed.commandName || parsed.commandToken);
    this.slashMatches = matches;
    this.slashList.setItems(toSelectItems(matches));
  }

  private selectedSlashCommand(): SlashCommandDefinition | undefined {
    const selected = this.slashList.getSelectedItem();
    return selected ? this.slashRegistry.find(selected.value) : undefined;
  }

  private openSelectorModal(options: {
    title: string;
    hint: string;
    items: SelectItem[];
    onSelect: (item: SelectItem) => void;
    initialFilter?: string;
    emptyMessage?: string;
    initialSelectedIndex?: number;
  }): void {
    this.modal = createSelectorModal({
      ...options,
      onCancel: () => {
        this.modal = { type: "none" };
        this.requestRender();
      }
    });
    this.requestRender();
  }

  private insertText(text: string): void {
    this.input.insert(text);
    this.slashPaletteSuppressed = false;
    this.refreshSlashPalette();
    this.requestRender();
  }

  private clearInput(): void {
    this.input.clear();
    this.slashPaletteSuppressed = false;
    this.refreshSlashPalette();
    this.requestRender();
  }

  private setInputValue(value: string): void {
    this.input.setText(value);
    this.slashPaletteSuppressed = false;
    this.refreshSlashPalette();
    this.requestRender();
  }

  private async submitPrompt(prompt: string): Promise<void> {
    const trimmed = prompt.trim();
    if (!trimmed) {
      return;
    }

    if (isSlashInput(trimmed)) {
      await this.executeSlashInput(prompt);
      return;
    }

    this.input.recordHistory(prompt);
    this.input.clear();
    this.running = true;
    this.requestRender();
    try {
      await this.options.agent.prompt(prompt);
    } catch (error) {
      this.running = false;
      this.status = error instanceof Error ? error.message : String(error);
      this.requestRender();
    }
  }

  private async executeSlashInput(commandLine: string): Promise<void> {
    const parsed = parseSlashInput(commandLine);
    if (!parsed) {
      return;
    }

    const command = parsed.commandName
      ? this.slashRegistry.find(parsed.commandName)
      : this.selectedSlashCommand();

    if (!command) {
      this.status = `Unknown command: ${parsed.commandToken || commandLine.trim()}`;
      this.requestRender();
      return;
    }

    const canonical = buildSlashCommandLine(command, parsed.argsText, parsed.hasTrailingSpace);
    this.input.replace(canonical);
    this.slashPaletteSuppressed = false;
    this.refreshSlashPalette();
    await this.slashExecutor.execute(command, {
      ...parsed,
      commandToken: command.fullName,
      commandName: command.name
    });
  }

  private async applySlashSelection(command: SlashCommandDefinition, argsText = "", hasTrailingSpace = false): Promise<void> {
    const value = buildSlashCommandLine(command, argsText, hasTrailingSpace);
    this.input.replace(value);
    this.slashPaletteSuppressed = false;
    this.refreshSlashPalette();
    await this.slashExecutor.execute(command, {
      raw: value,
      trimmed: value.trim(),
      commandToken: command.fullName,
      commandName: command.name,
      argsText,
      hasTrailingSpace
    });
  }

  private navigateHistory(direction: "up" | "down"): void {
    const nextValue = this.input.navigateHistory(direction);
    if (nextValue !== null) {
      this.setInputValue(nextValue);
    }
  }

  private isBracketedPaste(data: string): boolean {
    return data.startsWith("\u001b[200~") && data.endsWith("\u001b[201~");
  }

  private handleApprovalInput(key: string): boolean {
    if (this.modal.type !== "approval") {
      return false;
    }

    if (key === "y" || key === "Y") {
      this.approvalResolver?.(true);
      this.approvalResolver = null;
      this.modal = { type: "none" };
      this.requestRender();
    } else if (key === "n" || key === "N" || key === "escape") {
      this.approvalResolver?.(false);
      this.approvalResolver = null;
      this.modal = { type: "none" };
      this.requestRender();
    }
    return true;
  }

  private handlePassiveModalInput(key: string): boolean {
    if (this.modal.type !== "help" && this.modal.type !== "onboarding" && this.modal.type !== "details") {
      return false;
    }

    if (key === "enter" || key === "escape" || key === "q") {
      this.modal = { type: "none" };
      this.requestRender();
    }
    return true;
  }

  private handleSelectorInput(data: string): boolean {
    if (this.modal.type !== "select") {
      return false;
    }

    this.modal.list.handleInput?.(data);
    return true;
  }

  private async handleGlobalShortcut(key: string): Promise<boolean> {
    if (key === "ctrl+c") {
      if (this.input.hasText) {
        this.clearInput();
      } else {
        this.cancelPendingApproval();
        if (this.isRunActive()) {
          this.options.agent.abort();
        }
        this.exit();
      }
      return true;
    }

    if (key === "ctrl+l") {
      if (this.isRunActive()) {
        this.setSwitchBlockedStatus();
        return true;
      }
      await this.selectorCoordinator.openProfileSelector();
      return true;
    }

    if (key === "ctrl+r") {
      if (this.isRunActive()) {
        this.setSwitchBlockedStatus();
        return true;
      }
      await this.selectorCoordinator.openSessionSelector();
      return true;
    }

    if (key === "ctrl+j") {
      this.insertText("\n");
      return true;
    }

    return false;
  }

  private async handleEscapeKey(): Promise<boolean> {
    if (this.isSlashPaletteVisible()) {
      this.slashPaletteSuppressed = true;
      this.requestRender();
      return true;
    }

    const now = Date.now();
    if (now - this.lastEscapeAt < 500) {
      this.lastEscapeAt = 0;
      if (this.isRunActive()) {
        this.setSwitchBlockedStatus();
        return true;
      }
      await this.selectorCoordinator.openTreeView();
    } else {
      this.lastEscapeAt = now;
      if (this.input.hasText) {
        this.clearInput();
      }
    }
    return true;
  }

  private handleSlashNavigation(key: string, data: string): boolean {
    if (!this.isSlashPaletteVisible()) {
      return false;
    }

    if (key === "up" || key === "down") {
      this.slashList.handleInput?.(data);
      this.requestRender();
      return true;
    }

    return false;
  }

  private async handleEnterKey(): Promise<boolean> {
    if (this.running) {
      return true;
    }

    if (this.isSlashContext()) {
      if (this.isSlashPaletteVisible()) {
        const parsed = this.getParsedSlashInput();
        const command = this.selectedSlashCommand();
        if (command) {
          await this.applySlashSelection(command, parsed?.argsText ?? "", parsed?.hasTrailingSpace ?? false);
          return true;
        }
      }

      await this.executeSlashInput(this.input.text);
      return true;
    }

    await this.submitPrompt(this.input.text);
    return true;
  }

  private handleCursorKey(key: string): boolean {
    if (key === "left") {
      return this.moveCursor(() => this.input.moveLeft());
    }

    if (key === "right") {
      return this.moveCursor(() => this.input.moveRight());
    }

    if (key === "home") {
      return this.moveCursor(() => this.input.moveHome());
    }

    if (key === "end") {
      return this.moveCursor(() => this.input.moveEnd());
    }

    return false;
  }

  private handleDeletionKey(key: string): boolean {
    if (key === "backspace") {
      return this.deleteText(() => this.input.deleteBackward());
    }

    if (key === "delete") {
      return this.deleteText(() => this.input.deleteForward());
    }

    return false;
  }

  private moveCursor(move: () => boolean): boolean {
    if (!move()) {
      return false;
    }

    this.requestRender();
    return true;
  }

  private deleteText(remove: () => boolean): boolean {
    if (!remove()) {
      return false;
    }

    this.slashPaletteSuppressed = false;
    this.refreshSlashPalette();
    this.requestRender();
    return true;
  }

  private handleHistoryKey(key: string): boolean {
    if (key === "up") {
      if (!this.isSlashContext()) {
        this.navigateHistory("up");
      }
      return true;
    }

    if (key === "down") {
      if (!this.isSlashContext()) {
        this.navigateHistory("down");
      }
      return true;
    }

    return false;
  }

  private render(width: number, height: number): string[] {
    const lines: string[] = [];
    const header = `${ansi.bold(ansi.cyan("mono"))} ${ansi.dim(truncateToWidth(this.status, Math.max(1, width - 5)))}`;
    lines.push(padRight(header, width));
    lines.push(this.rule(width));
    lines.push(...this.renderSection(width, "Task", this.renderTask(width)));
    lines.push(...this.renderSection(width, "Conversation", this.renderConversation(width)));
    lines.push(...this.renderSection(width, "Tools", this.renderTools(width)));
    lines.push(...this.renderSection(width, "Editor", this.renderEditor(width)));

    const currentModel = this.initialized ? this.options.agent.getCurrentModel() : undefined;
    const currentProfile = this.initialized ? this.options.agent.getProfileName() : "<loading>";
    const currentSession = this.initialized ? this.options.agent.getSessionId().slice(0, 8) : "<pending>";
    const currentTask = this.initialized ? this.options.agent.getCurrentTask() : undefined;
    const configPath = this.initialized ? this.options.agent.getConfigSummary().globalConfigPath : "~/.mono/config.json";
    const memoryPath = this.initialized ? this.options.agent.getMemoryStorePath() : ".mono/memories";
    const footerText = `profile:${currentProfile}  model:${currentModel?.provider ?? "?"}/${currentModel?.modelId ?? "?"}  session:${currentSession}  task:${currentTask?.phase ?? "idle"}  memory:${memoryPath}  config:${configPath}`;
    lines.push(this.rule(width));
    lines.push(padRight(ansi.dim(truncateToWidth(footerText, width)), width));
    lines.push(padRight(ansi.dim(this.running ? "running" : "idle"), width));

    if (this.modal.type !== "none") {
      lines.push(this.rule(width));
      lines.push(...this.renderModal(width));
    }

    return lines.slice(0, height);
  }

  private rule(width: number): string {
    return padRight(ansi.dim("-".repeat(Math.max(1, width))), width);
  }

  private renderSection(width: number, title: string, body: string[]): string[] {
    return [padRight(ansi.bold(title), width), ...body];
  }

  private renderConversation(width: number): string[] {
    return renderConversationSection({
      messages: this.messages,
      streamingText: this.streamingText,
      streamingThinking: this.streamingThinking,
      width
    });
  }

  private renderTask(width: number): string[] {
    return renderTaskSection(this.initialized ? this.options.agent.getCurrentTask() : undefined, width);
  }

  private renderTools(width: number): string[] {
    return renderToolsSection(this.toolRuns, width);
  }

  private renderEditor(width: number): string[] {
    return renderEditorSection({
      inputValue: this.input.text,
      cursor: this.input.cursor,
      slashPaletteVisible: this.isSlashPaletteVisible(),
      slashPaletteLines: this.slashList.render(Math.max(1, width - 2)),
      width
    });
  }

  private renderModal(width: number): string[] {
    return renderModal(this.modal, width);
  }
}

export async function runInteractiveApp(options: InteractiveAppProps): Promise<void> {
  const app = new MonoInteractiveApp(options);
  try {
    await app.run();
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}
