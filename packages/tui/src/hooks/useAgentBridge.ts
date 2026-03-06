import { useEffect } from "react";
import type { Agent } from "@mono/agent-core";
import type { RuntimeEvent } from "@mono/shared";
import type { Dispatch, SetStateAction } from "react";
import type { DialogInstance, UIHistoryItem, UIState, UIToast } from "../types/ui.js";

interface UseAgentBridgeOptions {
  agent: Agent;
  setUiState: Dispatch<SetStateAction<UIState>>;
  pushDialog: (dialog: DialogInstance) => void;
}

export function useAgentBridge(options: UseAgentBridgeOptions): void {
  useEffect(() => {
    const { agent, setUiState, pushDialog } = options;

    void agent.initialize().then(() => {
      setUiState((current) => ({
        ...current,
        initialized: true,
        history: agent.getMessages().map((message) => ({
          id: `message-${message.timestamp}-${Math.random().toString(36).slice(2, 6)}`,
          type: "message",
          message
        })),
        currentTask: agent.getCurrentTask(),
        currentTodoRecord: agent.getCurrentTodoRecord(),
        status: agent.getConfigSummary().hasAnyProfiles ? "Ready" : "No configured profiles found. Run mono auth login."
      }));
    });

    agent.setRequestApproval(
      (request) =>
        new Promise<boolean>((resolve) => {
          pushDialog({
            id: `approval-${Date.now()}`,
            type: "approval",
            title: `Approve ${request.toolName}`,
            toolName: request.toolName,
            reason: request.reason,
            input: JSON.stringify(request.input, null, 2),
            resolve
          });
        })
    );

    const unsubscribe = agent.subscribe((event) => {
      setUiState((current) => reduceEvent(current, event, agent));
    });

    return () => {
      unsubscribe();
    };
  }, [options.agent, options.pushDialog, options.setUiState]);
}

function reduceEvent(state: UIState, event: RuntimeEvent, agent: Agent): UIState {
  switch (event.type) {
    case "assistant-start":
      return {
        ...state,
        running: true,
        pendingAssistant: { text: "", thinking: "" },
        status: "Assistant is thinking..."
      };
    case "assistant-text-delta":
      return {
        ...state,
        pendingAssistant: {
          text: `${state.pendingAssistant?.text ?? ""}${event.delta}`,
          thinking: state.pendingAssistant?.thinking ?? ""
        },
        status: "Streaming response..."
      };
    case "assistant-thinking-delta":
      return {
        ...state,
        pendingAssistant: {
          text: state.pendingAssistant?.text ?? "",
          thinking: `${state.pendingAssistant?.thinking ?? ""}${event.delta}`
        },
        status: "Reasoning..."
      };
    case "tool-start":
      return {
        ...state,
        pendingTools: [
          ...state.pendingTools.filter((item) => item.callId !== event.toolCallId),
          { callId: event.toolCallId, name: event.toolName, status: "running", output: stringify(event.input) }
        ],
        status: `Running ${event.toolName}...`
      };
    case "tool-update":
      return {
        ...state,
        pendingTools: state.pendingTools.map((item) =>
          item.callId === event.toolCallId ? { ...item, output: stringify(event.update.content) } : item
        )
      };
    case "tool-end":
      return {
        ...state,
        pendingTools: state.pendingTools.map((item) =>
          item.callId === event.toolCallId
            ? {
                ...item,
                status: event.isError ? "error" : "done",
                output: stringify(event.result.content)
              }
            : item
        ),
        status: event.isError ? `${event.toolName} failed` : `${event.toolName} completed`
      };
    case "message":
      return {
        ...state,
        history: [
          ...state.history,
          {
            id: `message-${event.message.timestamp}-${Math.random().toString(36).slice(2, 6)}`,
            type: "message",
            message: event.message
          }
        ],
        pendingAssistant: event.message.role === "assistant" ? null : state.pendingAssistant,
        pendingTools:
          event.message.role === "tool"
            ? state.pendingTools.filter((item) => item.callId !== (event.message.role === "tool" ? event.message.toolCallId : undefined))
            : state.pendingTools
      };
    case "memory-recalled":
      return pushToast(state, {
        id: `toast-${Date.now()}`,
        level: "info",
        message: `Recalled ${event.plan.selectedIds.length} memories`
      }, agent.getCurrentTask());
    case "memory-persisted":
      return pushToast(state, {
        id: `toast-${Date.now()}`,
        level: "success",
        message: `Memory saved: ${event.record.id}`
      }, agent.getCurrentTask());
    case "session-compressed":
      return {
        ...pushSystemMessage(state, `Compressed ${event.result.replacedMessageCount} messages into a session summary`, "muted"),
        currentTask: agent.getCurrentTask(),
        status: `Compressed ${event.result.replacedMessageCount} messages`
      };
    case "task-start":
      return { ...state, currentTask: event.task, currentTodoRecord: agent.getCurrentTodoRecord(), running: true, status: `Planning task: ${event.task.goal}` };
    case "task-update":
    case "task-phase-change":
      return { ...state, currentTask: event.task, currentTodoRecord: agent.getCurrentTodoRecord(), status: currentTaskStatus(event.task) };
    case "task-verify-start":
      return { ...state, currentTask: event.task, currentTodoRecord: agent.getCurrentTodoRecord(), status: "Verifying result..." };
    case "task-verify-result":
      return { ...state, currentTask: event.task, currentTodoRecord: agent.getCurrentTodoRecord(), status: event.passed ? "Verification passed" : `Verification failed: ${event.reason}` };
    case "task-todos-updated":
      return {
        ...state,
        currentTodoRecord: event.record,
        status: `Updated ${event.record.todos.length} todo item(s)`
      };
    case "task-todos-cleared":
      return {
        ...state,
        currentTodoRecord: undefined,
        status: "Cleared the current todo list"
      };
    case "task-summary":
      return {
        ...pushSystemMessage(state, event.result.summary, "success"),
        currentTask: agent.getCurrentTask(),
        status: event.result.summary
      };
    case "loop-detected":
      return {
        ...pushSystemMessage(state, `Loop detected: ${event.reason}`, "warning"),
        currentTask: event.task,
        status: `Loop detected: ${event.reason}`
      };
    case "run-end":
      return {
        ...state,
        running: false,
        pendingAssistant: null,
        pendingTools: [],
        currentTask: agent.getCurrentTask(),
        status: "Ready"
      };
    case "run-aborted":
      return {
        ...state,
        running: false,
        pendingAssistant: null,
        pendingTools: [],
        currentTask: agent.getCurrentTask(),
        status: "Cancelled"
      };
    case "error":
      return {
        ...state,
        running: false,
        pendingAssistant: null,
        pendingTools: [],
        status: event.error.message
      };
    default:
      return state;
  }
}

function pushToast(state: UIState, toast: UIToast, currentTask = state.currentTask): UIState {
  return {
    ...state,
    currentTask,
    toasts: [...state.toasts, toast].slice(-3),
    status: toast.message
  };
}

function pushSystemMessage(state: UIState, text: string, tone: "muted" | "info" | "warning" | "error" | "success"): UIState {
  return {
    ...state,
    history: [
      ...state.history,
      {
        id: `system-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: "system",
        text,
        tone
      }
    ]
  };
}

function stringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function currentTaskStatus(task: UIState["currentTask"]): string {
  if (!task) {
    return "Ready";
  }
  return `Task phase: ${task.phase}`;
}
