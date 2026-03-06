import type { Agent } from "@mono/agent-core";
import type { SelectItem } from "@mono/pi-tui";
import type { ConversationMessage, SessionNodeSummary, SessionSummary } from "@mono/shared";
import { createModelItems, createProfileItems, createSessionItems, createTreeItems } from "./selector-items.js";

interface SelectorModalOptions {
  title: string;
  hint: string;
  items: SelectItem[];
  onSelect: (item: SelectItem) => void;
  initialFilter?: string;
  emptyMessage?: string;
  initialSelectedIndex?: number;
}

interface SelectorCoordinatorActions {
  openSelectorModal: (options: SelectorModalOptions) => void;
  closeModal: () => void;
  setStatus: (status: string) => void;
  clearInput: () => void;
  replaceMessages: (messages: ConversationMessage[]) => void;
  requestRender: () => void;
}

export class SelectorCoordinator {
  constructor(
    private readonly agent: Agent,
    private readonly actions: SelectorCoordinatorActions
  ) {}

  async openProfileSelector(initialFilter?: string): Promise<void> {
    const profiles = await this.agent.listProfiles();
    this.actions.openSelectorModal({
      items: createProfileItems(profiles),
      title: "Profiles",
      hint: "Enter select, Esc close",
      onSelect: (item) => {
        void this.selectProfile(item.value);
      },
      initialFilter,
      emptyMessage: "  No matching profiles"
    });
  }

  async openModelSelector(initialFilter?: string): Promise<void> {
    const models = await this.agent.listModels();
    this.actions.openSelectorModal({
      items: createModelItems(models),
      title: "Models",
      hint: "Enter select, Esc close",
      onSelect: (item) => {
        void this.selectModel(item.value);
      },
      initialFilter,
      emptyMessage: "  No matching models"
    });
  }

  async openSessionSelector(initialFilter?: string): Promise<void> {
    const sessions = await this.agent.listSessions();
    this.actions.openSelectorModal({
      items: createSessionItems(sessions),
      title: "Sessions",
      hint: "Enter select, Esc close",
      onSelect: (item) => {
        void this.selectSession(item.value, sessions);
      },
      initialFilter,
      emptyMessage: "  No matching sessions"
    });
  }

  async openTreeView(initialFilter?: string): Promise<void> {
    const nodes = await this.agent.listSessionNodes();
    this.actions.openSelectorModal({
      items: createTreeItems(nodes),
      title: "Session Tree",
      hint: "Enter checkout, Esc close",
      onSelect: (item) => {
        void this.selectBranch(item.value, nodes);
      },
      initialFilter,
      emptyMessage: "  No matching nodes",
      initialSelectedIndex: initialFilter ? undefined : this.defaultTreeIndex(nodes)
    });
  }

  private defaultTreeIndex(nodes: SessionNodeSummary[]): number | undefined {
    return nodes.length > 0 ? nodes.length - 1 : undefined;
  }

  private async selectProfile(profile: string): Promise<void> {
    try {
      const resolved = await this.agent.setProfile(profile);
      this.finalizeSelection(`Profile set to ${resolved.profileName}`);
    } catch (error) {
      this.failSelection(error);
    }
  }

  private async selectModel(selection: string): Promise<void> {
    try {
      const model = await this.agent.setModel(selection);
      this.finalizeSelection(`Model set to ${model.provider}/${model.modelId}`);
    } catch (error) {
      this.failSelection(error);
    }
  }

  private async selectSession(sessionId: string, sessions: SessionSummary[]): Promise<void> {
    try {
      const selected = sessions.find((item) => item.sessionId === sessionId);
      if (!selected) {
        return;
      }

      const messages = await this.agent.switchSession(selected.sessionId);
      this.actions.replaceMessages(messages);
      this.finalizeSelection(`Switched session ${selected.sessionId.slice(0, 8)}`);
    } catch (error) {
      this.failSelection(error);
    }
  }

  private async selectBranch(nodeId: string, nodes: SessionNodeSummary[]): Promise<void> {
    try {
      const selected = nodes.find((item) => item.id === nodeId);
      if (!selected) {
        return;
      }

      const messages = await this.agent.switchBranch(selected.id);
      this.actions.replaceMessages(messages);
      this.finalizeSelection(`Checked out node ${selected.id.slice(0, 8)}`);
    } catch (error) {
      this.failSelection(error);
    }
  }

  private finalizeSelection(status: string): void {
    this.actions.closeModal();
    this.actions.setStatus(status);
    this.actions.clearInput();
  }

  private failSelection(error: unknown): void {
    this.actions.setStatus(error instanceof Error ? error.message : String(error));
    this.actions.requestRender();
  }
}
