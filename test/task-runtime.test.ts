import { describe, expect, it } from "vitest";
import type { ConversationMessage, UnifiedModel } from "../packages/shared/src/index.js";
import {
  advanceTaskPhase,
  applyVerificationMode,
  buildTaskContext,
  buildTaskSummary,
  buildTaskTurnPlan,
  compressConversation,
  createTaskState,
  shouldCompressMessages,
  updateTaskAfterTurn
} from "../packages/agent-core/src/task-runtime.js";

const model: UnifiedModel = {
  provider: "openai",
  modelId: "gpt-4.1-mini",
  family: "openai-compatible",
  baseURL: "https://api.openai.com/v1",
  supportsTools: true,
  supportsReasoning: true
};

describe("task runtime", () => {
  it("creates a task with execution and verification todos", () => {
    const task = createTaskState({
      goal: "fix the failing test and verify it",
      model,
      existingMessages: []
    });

    expect(task.phase).toBe("plan");
    expect(task.verification.mode).toBe("strict");
    expect(task.todos.map((todo) => todo.id)).toEqual(["understand-request", "execute", "verify", "summarize"]);
  });

  it("moves from execute to verify and then to summarize with verification evidence", () => {
    let task = createTaskState({
      goal: "fix the build and verify it",
      model,
      existingMessages: []
    });
    task = advanceTaskPhase(task, "execute");

    const executeUpdate = updateTaskAfterTurn({
      task,
      turnMessages: [
        {
          role: "assistant",
          provider: "openai",
          model: "gpt-4.1-mini",
          stopReason: "tool_use",
          timestamp: Date.now(),
          content: [{ type: "text", text: "I updated the failing code path." }]
        }
      ]
    });
    expect(executeUpdate.nextPhase).toBe("verify");

    task = advanceTaskPhase(executeUpdate.task, "verify");
    const verifyUpdate = updateTaskAfterTurn({
      task,
      turnMessages: [
        {
          role: "tool",
          toolCallId: "tool-1",
          toolName: "bash",
          content: "vitest passed with 0 failed and exit code 0",
          isError: false,
          timestamp: Date.now()
        }
      ]
    });

    expect(verifyUpdate.verification?.passed).toBe(true);
    expect(verifyUpdate.nextPhase).toBe("summarize");
  });

  it("detects loops when the same tool repeats", () => {
    const task = advanceTaskPhase(
      createTaskState({
        goal: "try to fix the issue",
        model,
        existingMessages: []
      }),
      "execute"
    );

    const update = updateTaskAfterTurn({
      task,
      turnMessages: [
        { role: "tool", toolCallId: "1", toolName: "bash", content: "same output", isError: false, timestamp: 1 },
        { role: "tool", toolCallId: "2", toolName: "bash", content: "same output", isError: false, timestamp: 2 },
        { role: "tool", toolCallId: "3", toolName: "bash", content: "same output", isError: false, timestamp: 3 }
      ]
    });

    expect(update.loopDetected).toBe(true);
    expect(update.nextPhase).toBe("blocked");
  });

  it("compresses long conversations into a session summary", () => {
    const messages: ConversationMessage[] = Array.from({ length: 16 }, (_, index) =>
      index % 2 === 0
        ? { role: "user", content: `user-${index}`, timestamp: index }
        : {
            role: "assistant",
            provider: "openai",
            model: "gpt-4.1-mini",
            stopReason: "stop",
            timestamp: index,
            content: [{ type: "text", text: `assistant-${index}` }]
          }
    );

    expect(shouldCompressMessages(messages)).toBe(true);
    const compressed = compressConversation(messages, model, 6);

    expect(compressed.result.replacedMessageCount).toBe(10);
    expect(compressed.messages[0]?.role).toBe("assistant");
    if (compressed.messages[0]?.role === "assistant") {
      expect(compressed.messages[0].content[0]?.type).toBe("text");
    }
    expect(buildTaskContext(createTaskState({ goal: "summarize repository", model, existingMessages: [] }))).toContain(
      "<TaskContext>"
    );
  });

  it("builds a deterministic task summary from assistant output", () => {
    const task = advanceTaskPhase(
      createTaskState({
        goal: "explain the repository",
        model,
        existingMessages: []
      }),
      "summarize"
    );

    const summary = buildTaskSummary(task, [
      {
        role: "assistant",
        provider: "openai",
        model: "gpt-4.1-mini",
        stopReason: "stop",
        timestamp: Date.now(),
        content: [{ type: "text", text: "I analyzed the project layout and highlighted the main packages." }]
      }
    ]);

    expect(summary).toContain("Latest outcome");
    expect(buildTaskTurnPlan(task).phase).toBe("execute");
  });

  it("restores the verify todo when verification mode is overridden from none to strict", () => {
    const task = createTaskState({
      goal: "explain the repository layout",
      model,
      existingMessages: []
    });

    expect(task.verification.mode).toBe("none");
    expect(task.todos.find((todo) => todo.id === "verify")?.status).toBe("cancelled");

    const overridden = applyVerificationMode(task, "strict");

    expect(overridden.verification.mode).toBe("strict");
    expect(overridden.todos.find((todo) => todo.id === "verify")?.status).toBe("pending");
  });

  it("keeps incomplete as a distinct terminal phase", () => {
    const task = advanceTaskPhase(
      createTaskState({
        goal: "fix the issue",
        model,
        existingMessages: []
      }),
      "incomplete"
    );

    expect(task.phase).toBe("incomplete");
    expect(task.todos.find((todo) => todo.id === "summarize")?.status).toBe("completed");
  });
});
