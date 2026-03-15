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
  it("creates a task shell without hard-coded todos", () => {
    const task = createTaskState({
      goal: "fix the failing test and verify it",
      model,
      existingMessages: []
    });

    expect(task.phase).toBe("plan");
    expect(task.verification.mode).toBe("strict");
    expect(task.currentTodoMemoryId).toBeUndefined();
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

  it("detects loops when the same tool signature repeats", () => {
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
        {
          role: "tool",
          toolCallId: "1",
          toolName: "bash",
          inputSignature: "bash:{\"command\":\"pnpm test\"}",
          content: "same output",
          isError: false,
          timestamp: 1
        },
        {
          role: "tool",
          toolCallId: "2",
          toolName: "bash",
          inputSignature: "bash:{\"command\":\"pnpm test\"}",
          content: "same output",
          isError: false,
          timestamp: 2
        },
        {
          role: "tool",
          toolCallId: "3",
          toolName: "bash",
          inputSignature: "bash:{\"command\":\"pnpm test\"}",
          content: "same output",
          isError: false,
          timestamp: 3
        }
      ]
    });

    expect(update.loopDetected).toBe(true);
    expect(update.nextPhase).toBe("blocked");
  });

  it("does not detect loops when the same readonly tool reads different files", () => {
    const task = advanceTaskPhase(
      createTaskState({
        goal: "inspect the repo structure",
        model,
        existingMessages: []
      }),
      "execute"
    );

    const update = updateTaskAfterTurn({
      task,
      turnMessages: [
        {
          role: "tool",
          toolCallId: "1",
          toolName: "read",
          inputSignature: "read:path=/repo/packages/tui/package.json;offset=1;limit=all",
          content: "file a",
          isError: false,
          timestamp: 1
        },
        {
          role: "tool",
          toolCallId: "2",
          toolName: "read",
          inputSignature: "read:path=/repo/packages/prompts/package.json;offset=1;limit=all",
          content: "file b",
          isError: false,
          timestamp: 2
        },
        {
          role: "tool",
          toolCallId: "3",
          toolName: "read",
          inputSignature: "read:path=/repo/README.md;offset=1;limit=all",
          content: "file c",
          isError: false,
          timestamp: 3
        }
      ]
    });

    expect(update.loopDetected).toBe(false);
    expect(update.nextPhase).toBe("summarize");
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
    expect(buildTaskContext(createTaskState({ goal: "summarize repository", model, existingMessages: [] }))).toContain(
      "Todos: <none>"
    );
  });

  it("keeps tool call and tool result history aligned when compressing", () => {
    const messages: ConversationMessage[] = [
      { role: "user", content: "user-0", timestamp: 0 },
      {
        role: "assistant",
        provider: "openai",
        model: "gpt-4.1-mini",
        stopReason: "stop",
        timestamp: 1,
        content: [{ type: "text", text: "assistant-1" }]
      },
      { role: "user", content: "user-2", timestamp: 2 },
      {
        role: "assistant",
        provider: "openai",
        model: "gpt-4.1-mini",
        stopReason: "stop",
        timestamp: 3,
        content: [{ type: "text", text: "assistant-3" }]
      },
      { role: "user", content: "user-4", timestamp: 4 },
      {
        role: "assistant",
        provider: "openai",
        model: "gpt-4.1-mini",
        stopReason: "tool_use",
        timestamp: 5,
        content: [
          {
            type: "tool-call",
            id: "tool-1",
            name: "read",
            arguments: { path: "README.md" }
          }
        ]
      },
      {
        role: "tool",
        toolCallId: "tool-1",
        toolName: "read",
        input: { path: "README.md" },
        inputSignature: "read:{\"path\":\"README.md\"}",
        content: "file contents",
        isError: false,
        timestamp: 6
      },
      {
        role: "assistant",
        provider: "openai",
        model: "gpt-4.1-mini",
        stopReason: "stop",
        timestamp: 7,
        content: [{ type: "text", text: "assistant-7" }]
      },
      { role: "user", content: "user-8", timestamp: 8 },
      {
        role: "assistant",
        provider: "openai",
        model: "gpt-4.1-mini",
        stopReason: "stop",
        timestamp: 9,
        content: [{ type: "text", text: "assistant-9" }]
      },
      { role: "user", content: "user-10", timestamp: 10 },
      {
        role: "assistant",
        provider: "openai",
        model: "gpt-4.1-mini",
        stopReason: "stop",
        timestamp: 11,
        content: [{ type: "text", text: "assistant-11" }]
      },
      { role: "user", content: "user-12", timestamp: 12 },
      {
        role: "assistant",
        provider: "openai",
        model: "gpt-4.1-mini",
        stopReason: "stop",
        timestamp: 13,
        content: [{ type: "text", text: "assistant-13" }]
      }
    ];

    const compressed = compressConversation(messages, model, 8);

    expect(compressed.result.preservedRecentMessages).toBe(9);
    expect(compressed.result.replacedMessageCount).toBe(5);
    expect(compressed.messages[1]).toMatchObject({
      role: "assistant",
      content: [
        {
          type: "tool-call",
          id: "tool-1",
          name: "read"
        }
      ]
    });
    expect(compressed.messages[2]).toMatchObject({
      role: "tool",
      toolCallId: "tool-1",
      toolName: "read"
    });
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

    expect(summary).toContain("Task status: done.");
    expect(summary).toContain("Latest outcome");
    expect(buildTaskTurnPlan(task).phase).toBe("execute");
  });

  it("overrides verification mode without relying on local todo state", () => {
    const task = createTaskState({
      goal: "explain the repository layout",
      model,
      existingMessages: []
    });

    expect(task.verification.mode).toBe("none");

    const overridden = applyVerificationMode(task, "strict");

    expect(overridden.verification.mode).toBe("strict");
  });

  it("treats casual Chinese questions as direct-response tasks", () => {
    const task = createTaskState({
      goal: "最近有什么有意思的事情吗",
      model,
      existingMessages: []
    });

    expect(task.verification.mode).toBe("none");
    expect(buildTaskTurnPlan(task).phase).toBe("execute");
  });

  it("summarizes after one turn for lightweight Chinese queries", () => {
    const task = advanceTaskPhase(
      createTaskState({
        goal: "你在本地有哪些代码",
        model,
        existingMessages: []
      }),
      "execute"
    );

    const update = updateTaskAfterTurn({
      task,
      turnMessages: [
        {
          role: "assistant",
          provider: "openai",
          model: "gpt-4.1-mini",
          stopReason: "stop",
          timestamp: Date.now(),
          content: [{ type: "text", text: "我列出了当前仓库的主要包。" }]
        }
      ]
    });

    expect(update.nextPhase).toBe("summarize");
    expect(update.verification).toBeUndefined();
  });

  it("summarizes light conversational turns without a verification pass when no tools ran", () => {
    const task = advanceTaskPhase(
      createTaskState({
        goal: "just checking in",
        model,
        existingMessages: []
      }),
      "execute"
    );

    expect(task.verification.mode).toBe("light");

    const update = updateTaskAfterTurn({
      task,
      turnMessages: [
        {
          role: "assistant",
          provider: "openai",
          model: "gpt-4.1-mini",
          stopReason: "stop",
          timestamp: Date.now(),
          content: [{ type: "text", text: "I'm here and ready to help." }]
        }
      ]
    });

    expect(update.nextPhase).toBe("summarize");
    expect(update.task.verification.mode).toBe("none");
    expect(update.verification).toBeUndefined();
  });

  it("does not bounce light verification back into execute when no evidence was needed", () => {
    const task = advanceTaskPhase(
      createTaskState({
        goal: "just checking in",
        model,
        existingMessages: []
      }),
      "verify"
    );

    expect(task.verification.mode).toBe("light");

    const update = updateTaskAfterTurn({
      task,
      turnMessages: [
        {
          role: "assistant",
          provider: "openai",
          model: "gpt-4.1-mini",
          stopReason: "stop",
          timestamp: Date.now(),
          content: [{ type: "text", text: "Everything is fine." }]
        }
      ]
    });

    expect(update.verification).toBeUndefined();
    expect(update.nextPhase).toBe("summarize");
    expect(update.task.verification.mode).toBe("none");
  });

  it("keeps Chinese implementation requests on the verified execution path", () => {
    const task = createTaskState({
      goal: "修复这个测试并验证结果",
      model,
      existingMessages: []
    });

    expect(task.verification.mode).toBe("strict");
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
    expect(task.verification.mode).toBe("strict");
  });
});
