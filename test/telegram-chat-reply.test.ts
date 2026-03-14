import { describe, expect, it } from "vitest";
import type { TaskResult } from "@mono/shared";
import { formatTelegramChatReply } from "../packages/tui/src/telegram-chat-reply.js";

function createTaskResult(overrides: Partial<TaskResult>): TaskResult {
  return {
    status: "done",
    summary: "Task status: done. Latest outcome: hello. Verification was not required.",
    turns: 1,
    messages: [],
    ...overrides,
  };
}

describe("telegram chat reply formatting", () => {
  it("prefers the latest assistant reply over the task summary", () => {
    const result = createTaskResult({
      status: "incomplete",
      summary: "Task status: incomplete. Latest outcome: Hello! Verification status: No strong verification evidence was collected.",
      messages: [
        {
          role: "assistant",
          provider: "openai",
          model: "gpt-4.1-mini",
          stopReason: "stop",
          timestamp: 1,
          content: [{ type: "text", text: "Hello! 👋" }],
        },
      ],
    });

    expect(formatTelegramChatReply(result)).toBe("Hello! 👋");
  });

  it("ignores assistant messages that only prepared tool calls", () => {
    const result = createTaskResult({
      status: "done",
      messages: [
        {
          role: "assistant",
          provider: "openai",
          model: "gpt-4.1-mini",
          stopReason: "tool_use",
          timestamp: 1,
          content: [{ type: "text", text: "I'll inspect the repo first." }],
        },
        {
          role: "tool",
          toolCallId: "tool-1",
          toolName: "read",
          content: "README contents",
          isError: false,
          timestamp: 2,
        },
        {
          role: "assistant",
          provider: "openai",
          model: "gpt-4.1-mini",
          stopReason: "stop",
          timestamp: 3,
          content: [{ type: "text", text: "The repository has a CLI, TUI, and Telegram control runtime." }],
        },
      ],
    });

    expect(formatTelegramChatReply(result)).toBe("The repository has a CLI, TUI, and Telegram control runtime.");
  });

  it("uses a short fallback when the run produced no assistant reply", () => {
    const result = createTaskResult({
      status: "incomplete",
      messages: [
        {
          role: "assistant",
          provider: "openai",
          model: "gpt-4.1-mini",
          stopReason: "tool_use",
          timestamp: 1,
          content: [{ type: "text", text: "I'll run a verification command." }],
        },
      ],
    });

    expect(formatTelegramChatReply(result)).toBe("I couldn't verify that yet.");
  });
});
