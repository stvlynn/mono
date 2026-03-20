import { describe, expect, it } from "vitest";
import { extractConversationOutcomeText, extractFinalReply, type ConversationMessage } from "../packages/shared/src/index.js";

function assistantMessage(
  stopReason: "stop" | "tool_use",
  text: string,
  timestamp: number,
): ConversationMessage {
  return {
    role: "assistant",
    provider: "openai",
    model: "gpt-4.1-mini",
    stopReason,
    timestamp,
    content: [{ type: "text", text }],
  };
}

describe("conversation outcome", () => {
  it("extracts a final-reply block from assistant text", () => {
    expect(extractFinalReply("prefix\n[final-reply]hello[/final-reply]\nsuffix")).toBe("hello");
  });

  it("prefers final-reply content over plain assistant text", () => {
    const text = extractConversationOutcomeText([
      assistantMessage("stop", "[final-reply]final answer[/final-reply]", 1),
    ]);

    expect(text).toBe("final answer");
  });

  it("does not treat tool-use text as the final outcome when tool activity exists", () => {
    const text = extractConversationOutcomeText([
      assistantMessage("stop", "最终答复", 3),
      assistantMessage("tool_use", "网站 stv.pm 是个 portfolio 页面，信息量很大！继续查关联项目：", 1),
      {
        role: "tool",
        toolCallId: "tool-1",
        toolName: "bash",
        content: "Navigation failed: net::ERR_NAME_NOT_RESOLVED",
        isError: false,
        timestamp: 2,
      },
    ], {
      includeToolUseAssistantText: true,
      includeToolResultFallback: true,
    });

    expect(text).toBe("最终答复");
  });
});
