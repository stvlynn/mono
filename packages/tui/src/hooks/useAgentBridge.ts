import { useEffect } from "react";
import type { Agent } from "@mono/agent-core";
import type { RuntimeEvent } from "@mono/shared";
import type { Dispatch, SetStateAction } from "react";
import type { UIHistoryItem, UIState, UIToast } from "../types/ui.js";
import {
  stringifyToolContent,
  summarizeToolContent,
  summarizeToolInput,
  summarizeToolResultDetail,
  summarizeToolUpdateDetail,
  summarizeToolUpdateLine
} from "../tool-display.js";
import { resolveWaitingCopy } from "../waiting-copy.js";

interface UseAgentBridgeOptions {
  agent: Agent;
  setUiState: Dispatch<SetStateAction<UIState>>;
}

export function useAgentBridge(options: UseAgentBridgeOptions): void {
  useEffect(() => {
    const { agent, setUiState } = options;

    const unsubscribe = agent.subscribe((event) => {
      setUiState((current) => reduceEvent(current, event, agent));
    });

    return () => {
      unsubscribe();
    };
  }, [options.agent, options.setUiState]);
}

export function reduceEvent(state: UIState, event: RuntimeEvent, agent: Agent): UIState {
  switch (event.type) {
    case "heartbeat-start":
      return {
        ...state,
        status: "Autonomy heartbeat..."
      };
    case "heartbeat-skip":
      return {
        ...state,
        status: `Heartbeat skipped: ${event.reason}`
      };
    case "heartbeat-decision":
      return {
        ...state,
        status: `Heartbeat decision: ${event.decision.decision}`
      };
    case "autonomy-task-enqueued":
      return {
        ...pushSystemMessage(state, `Autonomy queued: ${event.intent.goal}`, "info"),
        status: `Autonomy queued: ${event.intent.kind}`
      };
    case "autonomy-task-resumed":
      return {
        ...pushSystemMessage(state, `Autonomy resumed: ${event.intent.goal}`, "info"),
        status: `Autonomy resumed: ${event.intent.kind}`
      };
    case "self-reflection-generated":
      return {
        ...pushSystemMessage(state, event.summary, "muted"),
        status: event.summary
      };
    case "feedback-integrated":
      return {
        ...state,
        status: `Integrated ${event.signals.length} feedback signal(s)`
      };
    case "budget-warning":
      return {
        ...pushSystemMessage(state, event.message, "warning"),
        currentTask: shouldDisplayForegroundTask(event.task) ? event.task : state.currentTask,
        status: event.message
      };
    case "autonomy-blocked":
      return {
        ...pushSystemMessage(state, `Autonomy blocked: ${event.reason}`, "warning"),
        status: `Autonomy blocked: ${event.reason}`
      };
    case "assistant-start":
      return {
        ...state,
        running: true,
        pendingAssistant: { text: "", thinking: "" },
        waitingCopy: resolveWaitingCopy("assistant_start"),
        status: "Assistant is thinking..."
      };
    case "assistant-text-delta":
      return {
        ...state,
        pendingAssistant: {
          text: `${state.pendingAssistant?.text ?? ""}${event.delta}`,
          thinking: state.pendingAssistant?.thinking ?? ""
        },
        waitingCopy:
          state.waitingCopy?.kind === "assistant_streaming" ? state.waitingCopy : resolveWaitingCopy("assistant_streaming"),
        status: "Streaming response..."
      };
    case "assistant-thinking-delta":
      return {
        ...state,
        pendingAssistant: {
          text: state.pendingAssistant?.text ?? "",
          thinking: `${state.pendingAssistant?.thinking ?? ""}${event.delta}`
        },
        waitingCopy:
          state.waitingCopy?.kind === "assistant_reasoning" ? state.waitingCopy : resolveWaitingCopy("assistant_reasoning"),
        status: "Reasoning..."
      };
    case "assistant-tool-call":
      return {
        ...state,
        pendingTools: upsertPendingTool(state.pendingTools, event.toolCallId, (current) => ({
          callId: event.toolCallId,
          name: event.toolName,
          status: current?.status === "running" ? "running" : "pending",
          summary: current?.summary ?? "Preparing tool call",
          detail: event.argsText
            ? `${current?.detail ?? ""}${event.argsText}`.trim()
            : current?.detail,
          argsText: event.argsText ? `${current?.argsText ?? ""}${event.argsText}` : current?.argsText
        })),
        status: `Preparing ${event.toolName}...`
      };
    case "tool-start":
      return {
        ...state,
        pendingTools: upsertPendingTool(state.pendingTools, event.toolCallId, () => ({
          callId: event.toolCallId,
          name: event.toolName,
          status: "running",
          summary: summarizeToolInput(event.input),
          detail: stringify(event.input),
          argsText: undefined
        })),
        waitingCopy: resolveWaitingCopy("tool_running", { toolName: event.toolName }),
        status: `Running ${event.toolName}...`
      };
    case "tool-update":
      return {
        ...state,
        pendingTools: upsertPendingTool(state.pendingTools, event.toolCallId, (current) => ({
          callId: event.toolCallId,
          name: current?.name ?? event.toolName,
          status: current?.status ?? "running",
          summary: summarizeToolUpdateLine(event.update),
          detail: summarizeToolUpdateDetail(event.update),
          argsText: current?.argsText
        }))
      };
    case "tool-end":
      return updateToolWaitingState(
        {
          ...state,
          pendingTools: upsertPendingTool(state.pendingTools, event.toolCallId, (current) => ({
            callId: event.toolCallId,
            name: current?.name ?? event.toolName,
            status: event.isError ? "error" : "done",
            summary: event.isError ? `Failed · ${summarizeToolContent(event.result.content)}` : `Completed · ${summarizeToolContent(event.result.content)}`,
            detail: summarizeToolResultDetail(event.result.content),
            argsText: current?.argsText
          }))
        },
        event.isError ? `${event.toolName} failed` : `${event.toolName} completed`
      );
    case "message":
      if (event.message.role === "tool") {
        const toolMessage = event.message;
        return updateToolWaitingState(
          {
            ...state,
            history: [
              ...state.history,
              {
                id: `message-${toolMessage.timestamp}-${Math.random().toString(36).slice(2, 6)}`,
                type: "message",
                message: toolMessage
              }
            ],
            pendingTools: state.pendingTools.filter((item) => item.callId !== toolMessage.toolCallId)
          },
          state.status
        );
      }

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
        pendingTools: state.pendingTools,
        waitingCopy: event.message.role === "assistant" ? undefined : state.waitingCopy
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
      return {
        ...state,
        currentTask: shouldDisplayForegroundTask(event.task) ? event.task : state.currentTask,
        currentTodoRecord: shouldDisplayForegroundTask(event.task) ? agent.getCurrentTodoRecord() : state.currentTodoRecord,
        running: true,
        waitingCopy: resolveWaitingCopy("task_planning", { goal: event.task.goal }),
        status: describeTaskStart(event.task)
      };
    case "task-update":
    case "task-phase-change":
      return {
        ...state,
        currentTask: shouldDisplayForegroundTask(event.task) ? event.task : state.currentTask,
        currentTodoRecord: shouldDisplayForegroundTask(event.task) ? agent.getCurrentTodoRecord() : state.currentTodoRecord,
        status: currentTaskStatus(shouldDisplayForegroundTask(event.task) ? event.task : state.currentTask),
      };
    case "task-verify-start":
      return {
        ...state,
        currentTask: shouldDisplayForegroundTask(event.task) ? event.task : state.currentTask,
        currentTodoRecord: shouldDisplayForegroundTask(event.task) ? agent.getCurrentTodoRecord() : state.currentTodoRecord,
        waitingCopy: resolveWaitingCopy("task_verifying", { goal: event.task.goal }),
        status: "Verifying result..."
      };
    case "task-verify-result":
      return {
        ...state,
        currentTask: shouldDisplayForegroundTask(event.task) ? event.task : state.currentTask,
        currentTodoRecord: shouldDisplayForegroundTask(event.task) ? agent.getCurrentTodoRecord() : state.currentTodoRecord,
        waitingCopy: undefined,
        status: event.passed ? "Verification passed" : `Verification failed: ${event.reason}`
      };
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
        currentTodoRecord: agent.getCurrentTodoRecord(),
        waitingCopy: undefined,
        status: event.result.summary
      };
    case "loop-detected":
      return {
        ...pushSystemMessage(state, `Loop detected: ${event.reason}`, "warning"),
        currentTask: shouldDisplayForegroundTask(event.task) ? event.task : state.currentTask,
        waitingCopy: undefined,
        status: `Loop detected: ${event.reason}`
      };
    case "run-end":
      return {
        ...state,
        running: false,
        waitingCopy: undefined,
        pendingAssistant: null,
        pendingTools: [],
        currentTask: agent.getCurrentTask(),
        currentTodoRecord: agent.getCurrentTodoRecord(),
        status: "Ready"
      };
    case "run-aborted":
      return {
        ...state,
        running: false,
        waitingCopy: undefined,
        pendingAssistant: null,
        pendingTools: [],
        currentTask: agent.getCurrentTask(),
        currentTodoRecord: agent.getCurrentTodoRecord(),
        status: "Cancelled"
      };
    case "error":
      return {
        ...state,
        running: false,
        waitingCopy: undefined,
        pendingAssistant: null,
        pendingTools: [],
        currentTask: agent.getCurrentTask(),
        currentTodoRecord: agent.getCurrentTodoRecord(),
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
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function upsertPendingTool(
  tools: UIState["pendingTools"],
  callId: string,
  build: (current?: UIState["pendingTools"][number]) => UIState["pendingTools"][number]
): UIState["pendingTools"] {
  const current = tools.find((item) => item.callId === callId);
  const next = build(current);
  const remaining = tools.filter((item) => item.callId !== callId);
  return [...remaining, next];
}

function currentTaskStatus(task: UIState["currentTask"]): string {
  if (!task) {
    return "Ready";
  }
  const origin = task.origin && task.origin !== "user" ? ` (${task.origin})` : "";
  return `Task phase: ${task.phase}${origin}`;
}

function describeTaskStart(task: NonNullable<UIState["currentTask"]>): string {
  if (task.origin && task.origin !== "user") {
    return `Planning ${task.origin} task: ${task.goal}`;
  }
  return `Planning task: ${task.goal}`;
}

function shouldDisplayForegroundTask(task: UIState["currentTask"]): boolean {
  return !task || task.origin === undefined || task.origin === "user";
}

function updateToolWaitingState(state: UIState, fallbackStatus: string): UIState {
  const activeTool = [...state.pendingTools].reverse().find((item) =>
    item.status === "pending" || item.status === "running" || item.status === "awaiting_approval"
  );
  if (!activeTool) {
    return {
      ...state,
      waitingCopy: state.waitingCopy?.kind === "tool_running" ? undefined : state.waitingCopy,
      status: fallbackStatus
    };
  }

  const waitingCopy =
    state.waitingCopy?.kind === "tool_running" && state.waitingCopy.toolName === activeTool.name
      ? state.waitingCopy
      : resolveWaitingCopy("tool_running", { toolName: activeTool.name });

  return {
    ...state,
    waitingCopy,
    status: `Running ${activeTool.name}...`
  };
}
