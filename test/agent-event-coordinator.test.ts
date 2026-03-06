import { describe, expect, it, vi } from "vitest";
import type { ConversationMessage } from "../packages/shared/src/types.js";
import { AgentEventCoordinator } from "../packages/tui/src/agent-event-coordinator.js";

function createActions() {
  const toolRuns: unknown[] = [];
  const messages: ConversationMessage[] = [];

  return {
    toolRuns,
    messages,
    actions: {
      setRunning: vi.fn(),
      setStatus: vi.fn(),
      setStreamingText: vi.fn(),
      appendStreamingText: vi.fn(),
      setStreamingThinking: vi.fn(),
      appendStreamingThinking: vi.fn(),
      upsertToolRun: vi.fn((toolRun) => {
        toolRuns.push(toolRun);
      }),
      openApprovalModal: vi.fn(),
      pushMessage: vi.fn((message) => {
        messages.push(message);
      }),
      requestRender: vi.fn()
    }
  };
}

describe("AgentEventCoordinator", () => {
  it("updates streaming and tool state from runtime events", () => {
    const { actions, toolRuns } = createActions();
    const coordinator = new AgentEventCoordinator(actions);

    coordinator.handle({ type: "assistant-start" });
    coordinator.handle({ type: "assistant-text-delta", delta: "hello" });
    coordinator.handle({ type: "tool-start", toolCallId: "1", toolName: "read", input: { path: "a" } });

    expect(actions.setRunning).toHaveBeenCalledWith(true);
    expect(actions.appendStreamingText).toHaveBeenCalledWith("hello");
    expect(actions.setStatus).toHaveBeenCalledWith("Running read...");
    expect(toolRuns).toHaveLength(1);
    expect(actions.requestRender).toHaveBeenCalledTimes(3);
  });

  it("applies initial state and ready status", () => {
    const { actions, messages } = createActions();
    const coordinator = new AgentEventCoordinator(actions);
    const initialMessage: ConversationMessage = { role: "user", content: "hi", timestamp: 1 };

    coordinator.applyInitialState([initialMessage], true);

    expect(messages).toEqual([initialMessage]);
    expect(actions.setStatus).toHaveBeenCalledWith("Ready");
    expect(actions.requestRender).toHaveBeenCalledTimes(1);
  });

  it("opens onboarding status when no profiles exist", () => {
    const { actions } = createActions();
    const coordinator = new AgentEventCoordinator(actions);

    coordinator.applyInitialState([], false);

    expect(actions.setStatus).toHaveBeenCalledWith("No configured profiles found. Run mono auth login.");
  });

  it("marks aborted runs as cancelled", () => {
    const { actions } = createActions();
    const coordinator = new AgentEventCoordinator(actions);

    coordinator.handle({ type: "run-aborted", reason: "user" });

    expect(actions.setRunning).toHaveBeenCalledWith(false);
    expect(actions.setStatus).toHaveBeenCalledWith("Cancelled");
    expect(actions.setStreamingText).toHaveBeenCalledWith("");
    expect(actions.setStreamingThinking).toHaveBeenCalledWith("");
  });

  it("updates task and compression statuses from runtime events", () => {
    const { actions } = createActions();
    const coordinator = new AgentEventCoordinator(actions);

    coordinator.handle({
      type: "task-start",
      task: {
        taskId: "task-1",
        goal: "fix tests",
        phase: "plan",
        attempts: 0,
        verification: { mode: "strict", evidence: [] }
      }
    });
    coordinator.handle({
      type: "session-compressed",
      result: {
        summary: "summary",
        preservedRecentMessages: 8,
        replacedMessageCount: 4,
        tokenEstimateBefore: 100,
        tokenEstimateAfter: 40
      }
    });

    expect(actions.setStatus).toHaveBeenCalledWith("Planning task: fix tests");
    expect(actions.setStatus).toHaveBeenCalledWith("Compressed 4 messages into a session summary");
  });
});
