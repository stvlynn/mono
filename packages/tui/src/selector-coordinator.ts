import type { Agent } from "@mono/agent-core";
import type { SelectItem } from "@mono/pi-tui";
import type { ConversationMessage, MemoryRecord, SessionNodeSummary, SessionSummary } from "@mono/shared";
import { createMemoryItems, createModelItems, createProfileItems, createSessionItems, createTreeItems } from "./selector-items.js";

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
  openDetailsModal: (title: string, lines: string[]) => void;
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

  async openMemorySelector(initialFilter?: string): Promise<void> {
    const records = initialFilter
      ? await this.resolveMemoryRecordsFromSearch(initialFilter)
      : await this.agent.listMemories(12);

    this.actions.openSelectorModal({
      items: createMemoryItems(records),
      title: initialFilter ? `Memory Search: ${initialFilter}` : "Memory",
      hint: "Enter show, Esc close",
      onSelect: (item) => {
        void this.showMemoryRecord(item.value);
      },
      emptyMessage: "  No matching memory records"
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

  private async showMemoryRecord(id: string): Promise<void> {
    try {
      const record = await this.agent.getMemoryRecord(id);
      if (!record) {
        this.actions.setStatus(`Memory record not found: ${id}`);
        this.actions.requestRender();
        return;
      }

      this.actions.openDetailsModal(
        `Memory ${record.id}`,
        formatMemoryDetails(record)
      );
      this.actions.setStatus(`Opened memory ${record.id}`);
      this.actions.clearInput();
      this.actions.requestRender();
    } catch (error) {
      this.failSelection(error);
    }
  }

  private async resolveMemoryRecordsFromSearch(query: string): Promise<MemoryRecord[]> {
    const matches = await this.agent.searchMemories(query);
    const records = await Promise.all(matches.map((match) => this.agent.getMemoryRecord(match.id)));
    return records.filter((record): record is MemoryRecord => record !== null);
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

function formatMemoryDetails(record: MemoryRecord): string[] {
  return [
    `Created: ${new Date(record.createdAt).toLocaleString()}`,
    `Files: ${record.files.join(", ") || "<none>"}`,
    `Tools: ${record.tools.join(", ") || "<none>"}`,
    `Parents: ${record.parents.join(", ") || "<none>"}`,
    `Referenced: ${record.referencedMemoryIds.join(", ") || "<none>"}`,
    `Input: ${record.input}`,
    `Output: ${record.output}`,
    "Compacted:",
    ...(record.compacted.length > 0 ? record.compacted.map((line) => `- ${line}`) : ["- <none>"])
  ];
}
