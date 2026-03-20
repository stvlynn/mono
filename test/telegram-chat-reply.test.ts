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
          content: [{ type: "text", text: "[final-reply]The repository has a CLI, TUI, and Telegram control runtime.[/final-reply]" }],
        },
      ],
    });

    expect(formatTelegramChatReply(result)).toBe("The repository has a CLI, TUI, and Telegram control runtime.");
  });

  it("does not send a generic done fallback when no reliable reply exists", () => {
    const result = createTaskResult({
      status: "done",
      messages: [
        {
          role: "assistant",
          provider: "openai",
          model: "gpt-4.1-mini",
          stopReason: "tool_use",
          timestamp: 1,
          content: [
            { type: "text", text: "我来帮你查一下 X 上 stv_lynn 的 follower 数量。" },
            { type: "tool-call", id: "tool-1", name: "bash", arguments: { command: "echo test" } },
          ],
        },
        {
          role: "tool",
          toolCallId: "tool-1",
          toolName: "bash",
          content: "not found",
          isError: false,
          timestamp: 2,
        },
      ],
    });

    expect(formatTelegramChatReply(result)).toBe("");
    expect(formatTelegramChatResponse(result)).toEqual({
      messages: [],
    });
  });

  it("uses final-reply content instead of tool-use preambles", () => {
    const result = createTaskResult({
      status: "done",
      messages: [
        {
          role: "assistant",
          provider: "openai",
          model: "gpt-4.1-mini",
          stopReason: "tool_use",
          timestamp: 1,
          content: [{ type: "text", text: "网站 stv.pm 是个 portfolio 页面，信息量很大！继续查关联项目：" }],
        },
        {
          role: "tool",
          toolCallId: "tool-1",
          toolName: "bash",
          content: "ok",
          isError: false,
          timestamp: 2,
        },
        {
          role: "assistant",
          provider: "openai",
          model: "gpt-4.1-mini",
          stopReason: "stop",
          timestamp: 3,
          content: [{
            type: "text",
            text: "[final-reply]已确认 stv.pm 是个人作品集页面，但关联项目追查暂时卡在域名解析和搜索封禁上。[/final-reply]",
          }],
        },
      ],
    });

    expect(formatTelegramChatReply(result)).toBe("已确认 stv.pm 是个人作品集页面，但关联项目追查暂时卡在域名解析和搜索封禁上。");
  });

  it("summarizes tool results when a done run produced no assistant text at all", () => {
    const result = createTaskResult({
      status: "done",
      summary: "Task status: done. No assistant summary was produced. Verification was not required.",
      messages: [
        {
          role: "assistant",
          provider: "openai",
          model: "gpt-4.1-mini",
          stopReason: "tool_use",
          timestamp: 1,
          content: [{ type: "tool-call", id: "tool-1", name: "bash", arguments: { command: "curl ..." } }],
        },
        {
          role: "tool",
          toolCallId: "tool-1",
          toolName: "bash",
          content: "bash: line 1: curl: command not found\n",
          isError: false,
          timestamp: 2,
        },
        {
          role: "tool",
          toolCallId: "tool-2",
          toolName: "bash",
          content: "not found\n",
          isError: false,
          timestamp: 3,
        },
        {
          role: "tool",
          toolCallId: "tool-3",
          toolName: "bash",
          content: "all failed\n",
          isError: false,
          timestamp: 4,
        },
      ],
    });

    expect(formatTelegramChatReply(result)).toBe("I tried to check that, but this runtime is missing required commands: curl.");
    expect(formatTelegramChatResponse(result)).toEqual({
      messages: [{ text: "I tried to check that, but this runtime is missing required commands: curl.", format: "markdown" }],
    });
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

  it("does not inject a Done fallback after a successful channel send with no final assistant text", () => {
    const result = createTaskResult({
      status: "done",
      messages: [
        {
          role: "assistant",
          provider: "openai",
          model: "gpt-4.1-mini",
          stopReason: "tool_use",
          timestamp: 1,
          content: [{ type: "text", text: "I'll send the reply in-channel." }],
        },
        {
          role: "tool",
          toolCallId: "tool-1",
          toolName: "channel_action",
          content: JSON.stringify({
            ok: true,
            channel: "telegram",
            action: "send",
            targetId: "123456",
            messageId: "42",
          }),
          isError: false,
          timestamp: 2,
        },
      ],
    });

    expect(formatTelegramChatReply(result)).toBe("");
    expect(formatTelegramChatResponse(result)).toEqual({ messages: [] });
  });

  it("does not inject a fallback after successful Telegram media channel actions", () => {
    for (const action of ["photo", "document"] as const) {
      const result = createTaskResult({
        status: "done",
        messages: [
          {
            role: "assistant",
            provider: "openai",
            model: "gpt-4.1-mini",
            stopReason: "tool_use",
            timestamp: 1,
            content: [{ type: "text", text: "I'll send the media in-channel." }],
          },
          {
            role: "tool",
            toolCallId: `tool-${action}`,
            toolName: "channel_action",
            content: JSON.stringify({
              ok: true,
              channel: "telegram",
              action,
              targetId: "123456",
              messageId: "42",
            }),
            isError: false,
            timestamp: 2,
          },
        ],
      });

      expect(formatTelegramChatReply(result)).toBe("");
      expect(formatTelegramChatResponse(result)).toEqual({ messages: [] });
    }
  });

  it("does not inject a Done fallback after a satisfied native channel delivery with no final assistant text", () => {
    const result = createTaskResult({
      status: "done",
      channelDelivery: {
        nativeActionRequired: true,
        action: "sticker",
        satisfied: true,
      },
      messages: [
        {
          role: "assistant",
          provider: "openai",
          model: "gpt-4.1-mini",
          stopReason: "tool_use",
          timestamp: 1,
          content: [{ type: "text", text: "I'll send the sticker directly." }],
        },
      ],
    });

    expect(formatTelegramChatReply(result)).toBe("");
    expect(formatTelegramChatResponse(result)).toEqual({ messages: [] });
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

  it("hides pre-final chatter from streamed preview text", () => {
    expect(sanitizeTelegramReplyPreview("先查一下站点情况")).toBe("先查一下站点情况");
    expect(sanitizeTelegramReplyPreview("先查一下站点情况\n[final-reply]已确认站点可访问")).toBe("已确认站点可访问");
    expect(sanitizeTelegramReplyPreview("先查一下站点情况\n[final-reply]已确认站点可访问[/final-reply]")).toBe("已确认站点可访问");
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
