import { afterEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@mono/agent-core";
import type { RuntimeEvent } from "../packages/shared/src/index.js";
import { resolveWaitingCopy } from "../packages/tui/src/waiting-copy.js";
import { reduceEvent } from "../packages/tui/src/hooks/useAgentBridge.js";
import type { UIState } from "../packages/tui/src/types/ui.js";

function createUiState(): UIState {
  return {
    initialized: true,
    running: false,
    status: "Ready",
    waitingCopy: undefined,
    history: [],
    pendingAssistant: null,
    pendingTools: [],
    dialogs: [],
    toasts: []
  };
}

function createAgentStub(): Agent {
  return {
    getCurrentTask: () => undefined,
    getCurrentTodoRecord: () => undefined
  } as unknown as Agent;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("waiting copy", () => {
  it("renders a waiting copy from the UI template generator", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    const waiting = resolveWaitingCopy("assistant_streaming");

    expect(waiting.kind).toBe("assistant_streaming");
    expect(waiting.message).toBe("正在敲键盘");
  });

  it("falls back cleanly when a required template variable is missing", () => {
    const waiting = resolveWaitingCopy("tool_running");

    expect(waiting.kind).toBe("tool_running");
    expect(waiting.message.length).toBeGreaterThan(0);
  });
});

describe("waiting copy reducer", () => {
  it("keeps the same randomized line while the same waiting kind stays active", () => {
    const agent = createAgentStub();
    let state = createUiState();

    state = reduceEvent(state, { type: "assistant-start" }, agent);
    state = reduceEvent(state, { type: "assistant-text-delta", delta: "A" }, agent);
    const firstStreamingLine = state.waitingCopy?.message;

    state = reduceEvent(state, { type: "assistant-text-delta", delta: "B" }, agent);

    expect(state.waitingCopy?.kind).toBe("assistant_streaming");
    expect(state.waitingCopy?.message).toBe(firstStreamingLine);
  });

  it("switches to a tool-specific waiting line and clears it on run end", () => {
    const agent = createAgentStub();
    let state = createUiState();

    state = reduceEvent(
      state,
      { type: "tool-start", toolCallId: "tool-1", toolName: "bash", input: { command: "ls" } },
      agent
    );

    expect(state.waitingCopy?.kind).toBe("tool_running");
    expect(state.waitingCopy?.message).toContain("bash");

    state = reduceEvent(state, { type: "run-end", messages: [] }, agent);

    expect(state.waitingCopy).toBeUndefined();
  });

  it("switches to task verification waiting copy when verification begins", () => {
    const agent = createAgentStub();
    let state = createUiState();
    const taskEvent = {
      type: "task-verify-start",
      task: {
        taskId: "task-1",
        goal: "fix the failing test",
        phase: "verify",
        attempts: 1,
        verification: {
          mode: "strict",
          evidence: []
        }
      }
    } satisfies RuntimeEvent;

    state = reduceEvent(state, taskEvent, agent);

    expect(state.waitingCopy?.kind).toBe("task_verifying");
    expect(state.status).toBe("Verifying result...");
  });

  it("keeps tool waiting copy while another tool is still running", () => {
    const agent = createAgentStub();
    let state = createUiState();

    state = reduceEvent(
      state,
      { type: "tool-start", toolCallId: "tool-1", toolName: "read", input: { path: "a.ts" } },
      agent
    );
    state = reduceEvent(
      state,
      { type: "tool-start", toolCallId: "tool-2", toolName: "bash", input: { command: "pnpm test" } },
      agent
    );
    state = reduceEvent(
      state,
      { type: "tool-end", toolCallId: "tool-1", toolName: "read", result: { content: "ok" }, isError: false },
      agent
    );

    expect(state.waitingCopy?.kind).toBe("tool_running");
    expect(state.waitingCopy?.message).toContain("bash");
    expect(state.status).toBe("Running bash...");
  });
});
