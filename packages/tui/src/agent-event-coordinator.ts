import type { ApprovalRequest, ConversationMessage, RuntimeEvent } from "@mono/shared";
import { summarizeToolUpdate } from "./ui-format.js";
import type { ToolRun } from "./ui-types.js";

interface AgentEventCoordinatorActions {
  setRunning: (running: boolean) => void;
  setStatus: (status: string) => void;
  setStreamingText: (value: string) => void;
  appendStreamingText: (value: string) => void;
  setStreamingThinking: (value: string) => void;
  appendStreamingThinking: (value: string) => void;
  upsertToolRun: (toolRun: ToolRun) => void;
  openApprovalModal: (request: ApprovalRequest) => void;
  pushMessage: (message: ConversationMessage) => void;
  requestRender: () => void;
}

export class AgentEventCoordinator {
  constructor(private readonly actions: AgentEventCoordinatorActions) {}

  handle(event: RuntimeEvent): void {
    switch (event.type) {
      case "assistant-start":
        this.actions.setRunning(true);
        this.actions.setStreamingText("");
        this.actions.setStreamingThinking("");
        this.actions.setStatus("Assistant is thinking...");
        break;
      case "memory-recalled":
        this.actions.setStatus(
          `Recalled ${event.plan.selectedIds.length} memories (${event.plan.compactedIds.length} compacted, ${event.plan.rawPairIds.length} raw)`
        );
        break;
      case "task-start":
        this.actions.setRunning(true);
        this.actions.setStatus(`Planning task: ${event.task.goal}`);
        break;
      case "task-update": {
        const current = event.task.todos.find((todo) => todo.status === "in_progress");
        this.actions.setStatus(current ? `${event.task.phase}: ${current.description}` : `Task phase: ${event.task.phase}`);
        break;
      }
      case "task-phase-change":
        this.actions.setStatus(`Task phase: ${event.task.phase}`);
        break;
      case "task-verify-start":
        this.actions.setStatus("Verifying result...");
        break;
      case "task-verify-result":
        this.actions.setStatus(event.passed ? "Verification passed" : `Verification failed: ${event.reason}`);
        break;
      case "task-summary":
        this.actions.setStatus(event.result.summary);
        break;
      case "session-compressed":
        this.actions.setStatus(`Compressed ${event.result.replacedMessageCount} messages into a session summary`);
        break;
      case "loop-detected":
        this.actions.setStatus(`Loop detected: ${event.reason}`);
        break;
      case "assistant-text-delta":
        this.actions.appendStreamingText(event.delta);
        this.actions.setStatus("Streaming response...");
        break;
      case "assistant-thinking-delta":
        this.actions.appendStreamingThinking(event.delta);
        this.actions.setStatus("Reasoning...");
        break;
      case "tool-start":
        this.actions.upsertToolRun({
          id: event.toolCallId,
          name: event.toolName,
          status: "running",
          output: JSON.stringify(event.input)
        });
        this.actions.setStatus(`Running ${event.toolName}...`);
        break;
      case "tool-update":
        this.actions.upsertToolRun({
          id: event.toolCallId,
          name: event.toolName,
          status: "running",
          output: summarizeToolUpdate(event.update)
        });
        break;
      case "tool-end":
        this.actions.upsertToolRun({
          id: event.toolCallId,
          name: event.toolName,
          status: event.isError ? "error" : "done",
          output:
            typeof event.result.content === "string"
              ? event.result.content
              : summarizeToolUpdate({ content: event.result.content })
        });
        this.actions.setStatus(event.isError ? `${event.toolName} failed` : `${event.toolName} completed`);
        break;
      case "approval-request":
        this.actions.openApprovalModal(event.request);
        break;
      case "approval-result":
        if (!event.approved && event.reason) {
          this.actions.setStatus(event.reason);
        }
        break;
      case "memory-persisted":
        this.actions.setStatus(`Memory saved: ${event.record.id}`);
        break;
      case "message":
        this.actions.pushMessage(event.message);
        if (event.message.role === "assistant") {
          this.actions.setStreamingText("");
          this.actions.setStreamingThinking("");
        }
        break;
      case "run-end":
        this.actions.setRunning(false);
        this.actions.setStatus("Ready");
        this.actions.setStreamingText("");
        this.actions.setStreamingThinking("");
        break;
      case "run-aborted":
        this.actions.setRunning(false);
        this.actions.setStatus("Cancelled");
        this.actions.setStreamingText("");
        this.actions.setStreamingThinking("");
        break;
      case "error":
        this.actions.setRunning(false);
        this.actions.setStatus(event.error.message);
        break;
      default:
        break;
    }

    this.actions.requestRender();
  }

  applyInitialState(messages: ConversationMessage[], hasProfiles: boolean): void {
    for (const message of messages) {
      this.actions.pushMessage(message);
    }

    if (!hasProfiles) {
      this.actions.setStatus("No configured profiles found. Run mono auth login.");
    } else {
      this.actions.setStatus("Ready");
    }

    this.actions.requestRender();
  }
}
