import type { Agent } from "@mono/agent-core";
import {
  getLastAssistantText,
  toolOrUserContentToPlainText,
  type ConversationMessage,
} from "@mono/shared";
import type { UIState } from "./types/ui.js";

export interface TuiPaneStateModel {
  pane: {
    queryGeneration: number;
    focused: boolean;
    hint: string;
  };
  history: {
    hasItems: boolean;
    items: Array<{
      id: string;
      role: string;
      title: string;
      body: string;
      detail?: string;
      thinking?: string;
      tone: "default" | "info" | "warning" | "error" | "success";
    }>;
  };
  pendingTools: {
    active: boolean;
    items: Array<{
      id: string;
      name: string;
      status: string;
      summary: string;
      detail?: string;
    }>;
  };
  pendingAssistant: {
    active: boolean;
    text: string;
    thinking: string;
    showThinking: boolean;
    markdownEnabled: boolean;
  };
  query: {
    running: boolean;
    status: string;
    taskPhase?: string;
    taskGoal?: string;
  };
}

export interface TuiRenderRequest {
  stateModel: TuiPaneStateModel;
  layoutFingerprint: string;
}

function truncateSummary(value: string, maxChars: number): string {
  const normalized = value.trim().replace(/\s+/gu, " ");
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, maxChars - 1)}…`;
}

function summarizeConversationMessage(message: ConversationMessage): TuiPaneStateModel["history"]["items"][number] {
  if (message.role === "user") {
    return {
      id: `user-${message.timestamp}`,
      role: "user",
      title: "You",
      body: truncateSummary(toolOrUserContentToPlainText(message.content), 1800),
      tone: "default",
    };
  }

  if (message.role === "assistant") {
    const thinking = message.content
      .filter((part) => part.type === "thinking")
      .map((part) => part.thinking)
      .join("\n\n")
      .trim();
    return {
      id: `assistant-${message.timestamp}`,
      role: "assistant",
      title: "Assistant",
      body: truncateSummary(getLastAssistantText(message), 2200),
      tone: "info",
      ...(thinking ? { thinking: truncateSummary(thinking, 1200) } : {}),
    };
  }

  return {
    id: `tool-${message.timestamp}-${message.toolCallId}`,
    role: "tool",
    title: `Tool · ${message.toolName}`,
    body: truncateSummary(toolOrUserContentToPlainText(message.content), 1600),
    tone: message.isError ? "error" : "warning",
    ...(typeof message.input === "undefined"
      ? {}
      : { detail: truncateSummary(JSON.stringify(message.input, null, 2), 600) }),
  };
}

export function createTuiPaneStateModel(options: {
  agent: Agent;
  uiState: UIState;
  paneGeneration: number;
}): TuiPaneStateModel {
  const { agent, uiState, paneGeneration } = options;
  const historyItems = uiState.history
    .filter((entry) => entry.type === "message")
    .slice(-40)
    .map((entry) => summarizeConversationMessage(entry.message));

  return {
    pane: {
      queryGeneration: paneGeneration,
      focused: uiState.focusTarget === "generated",
      hint: uiState.focusTarget === "generated"
        ? "Generated pane focused. Use Tab/Shift+Tab inside the pane. Press Ctrl+O to return to shell."
        : "Press Ctrl+O to focus the generated pane.",
    },
    history: {
      hasItems: historyItems.length > 0,
      items: historyItems,
    },
    pendingTools: {
      active: uiState.pendingTools.length > 0,
      items: uiState.pendingTools.map((tool) => ({
        id: tool.callId,
        name: tool.name,
        status: tool.status,
        summary: tool.summary,
        ...(tool.detail ? { detail: truncateSummary(tool.detail, 600) } : {}),
      })),
    },
    pendingAssistant: {
      active: Boolean(uiState.pendingAssistant || uiState.running),
      text: truncateSummary(uiState.pendingAssistant?.text ?? "", 2200),
      thinking: truncateSummary(uiState.pendingAssistant?.thinking ?? "", 1200),
      showThinking: true,
      markdownEnabled: true,
    },
    query: {
      running: uiState.running,
      status: uiState.status,
      taskPhase: uiState.currentTask?.phase,
      taskGoal: uiState.currentTask?.goal,
    },
  };
}

export function createTuiRenderRequest(options: {
  agent: Agent;
  uiState: UIState;
  paneGeneration: number;
}): TuiRenderRequest {
  const stateModel = createTuiPaneStateModel(options);
  return {
    stateModel,
    layoutFingerprint: `query:${options.paneGeneration}`,
  };
}

export function flattenTuiStateModel(model: TuiPaneStateModel): Record<string, unknown> {
  return {
    "/pane": model.pane,
    "/history": model.history,
    "/pendingTools": model.pendingTools,
    "/pendingAssistant": model.pendingAssistant,
    "/query": model.query,
  };
}

export function renderTuiPresentationAsJson(request: TuiRenderRequest): string {
  return JSON.stringify(request, null, 2);
}
