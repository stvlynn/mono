import { describe, expect, it } from "vitest";
import type { TaskResult } from "@mono/shared";
import {
  formatTelegramChatReply,
  formatTelegramChatResponse,
  sanitizeTelegramReplyPreview,
} from "../packages/tui/src/telegram-chat-reply.js";

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

  it("splits long paragraph-separated replies into multiple Telegram messages", () => {
    const result = createTaskResult({
      status: "done",
      messages: [
        {
          role: "assistant",
          provider: "openai",
          model: "gpt-4.1-mini",
          stopReason: "stop",
          timestamp: 1,
          content: [{
            type: "text",
            text: [
              "Paragraph one ".repeat(90).trim(),
              "Paragraph two ".repeat(90).trim(),
              "```ts\nconst alpha = 1;\nconst beta = 2;\n```",
            ].join("\n\n"),
          }],
        },
      ],
    });

    const response = formatTelegramChatResponse(result);

    expect(response.messages).toHaveLength(3);
    expect(response.messages[0]?.text).toContain("Paragraph one");
    expect(response.messages[1]?.text).toContain("Paragraph two");
    expect(response.messages[2]?.text).toContain("```ts");
  });

  it("extracts a Telegram sticker tag from the final assistant reply", () => {
    const result = createTaskResult({
      status: "done",
      messages: [
        {
          role: "assistant",
          provider: "openai",
          model: "gpt-4.1-mini",
          stopReason: "stop",
          timestamp: 1,
          content: [{
            type: "text",
            text: "Looks good.\n\n[telegram-sticker:🙂]",
          }],
        },
      ],
    });

    const response = formatTelegramChatResponse(result);

    expect(response.messages).toEqual([{ text: "Looks good.", format: "markdown" }]);
    expect(response.sticker).toEqual({ emoji: "🙂" });
  });

  it("extracts a direct Telegram sticker file-id tag from the final assistant reply", () => {
    const result = createTaskResult({
      status: "done",
      messages: [
        {
          role: "assistant",
          provider: "openai",
          model: "gpt-4.1-mini",
          stopReason: "stop",
          timestamp: 1,
          content: [{
            type: "text",
            text: "Sending the same sticker back.\n\n[telegram-sticker-file:CAACAgIAAxkBAAIBQ2abc123]",
          }],
        },
      ],
    });

    const response = formatTelegramChatResponse(result);

    expect(response.messages).toEqual([{ text: "Sending the same sticker back.", format: "markdown" }]);
    expect(response.sticker).toEqual({ fileId: "CAACAgIAAxkBAAIBQ2abc123" });
  });

  it("allows sticker-only Telegram replies without injecting fallback text", () => {
    const result = createTaskResult({
      status: "done",
      messages: [
        {
          role: "assistant",
          provider: "openai",
          model: "gpt-4.1-mini",
          stopReason: "stop",
          timestamp: 1,
          content: [{
            type: "text",
            text: "[telegram-sticker-file:CAACAgIAAxkBAAIBQ2abc123]",
          }],
        },
      ],
    });

    expect(formatTelegramChatReply(result)).toBe("");
    expect(formatTelegramChatResponse(result)).toEqual({
      messages: [],
      sticker: { fileId: "CAACAgIAAxkBAAIBQ2abc123" },
    });
  });

  it("hides Telegram sticker metadata from streamed preview text", () => {
    expect(sanitizeTelegramReplyPreview("Almost done\n[telegram-sticker:")).toBe("Almost done");
    expect(sanitizeTelegramReplyPreview("Almost done\n[telegram-sticker:🙂]")).toBe("Almost done");
    expect(sanitizeTelegramReplyPreview("Almost done\n[telegram-sticker-file:CAAC")).toBe("Almost done");
  });

  it("uses a native-action fallback when the requested channel action was not satisfied", () => {
    const result = createTaskResult({
      status: "incomplete",
      channelDelivery: {
        nativeActionRequired: true,
        action: "sticker",
        satisfied: false,
      },
      messages: [
        {
          role: "assistant",
          provider: "openai",
          model: "gpt-4.1-mini",
          stopReason: "stop",
          timestamp: 1,
          content: [{ type: "text", text: "I cannot send stickers." }],
        },
      ],
    });

    expect(formatTelegramChatReply(result)).toBe("I couldn't complete the requested sticker action yet.");
    expect(formatTelegramChatResponse(result)).toEqual({
      messages: [{ text: "I couldn't complete the requested sticker action yet.", format: "markdown" }],
    });
  });
});
