import { describe, expect, it } from "vitest";
import {
  resolveTranscriptPolicy,
  sanitizeConversationMessages,
  type ConversationMessage,
  type UnifiedModel,
} from "../packages/shared/src/index.js";
import { createTestUnifiedModel, describeIfRealTestModel } from "./helpers/test-model-env.js";

const model: UnifiedModel = createTestUnifiedModel({
  apiKey: "test-key",
});

describeIfRealTestModel("transcript repair", () => {
  it("drops malformed tool calls that are not allowed for the current turn", () => {
    const messages: ConversationMessage[] = [
      {
        role: "assistant",
        provider: "openai",
        model: model.modelId,
        stopReason: "tool_use",
        timestamp: 1,
        content: [
          {
            type: "tool-call",
            id: "call_1",
            name: "bash",
            arguments: { command: "pwd" },
          },
          {
            type: "text",
            text: "Let me check that.",
          },
        ],
      },
    ];

    const result = sanitizeConversationMessages(messages, {
      policy: resolveTranscriptPolicy(model),
      allowedToolNames: ["read"],
    });

    expect(result.droppedMalformedToolCalls).toBe(1);
    expect(result.messages).toHaveLength(1);
    const assistant = result.messages[0];
    expect(assistant?.role).toBe("assistant");
    if (assistant?.role === "assistant") {
      expect(assistant.content.some((part) => part.type === "tool-call")).toBe(false);
    }
  });

  it("inserts synthetic tool results for missing tool responses", () => {
    const messages: ConversationMessage[] = [
      {
        role: "assistant",
        provider: "openai",
        model: model.modelId,
        stopReason: "tool_use",
        timestamp: 1,
        content: [
          {
            type: "tool-call",
            id: "call_1",
            name: "read",
            arguments: { path: "README.md" },
          },
        ],
      },
      {
        role: "assistant",
        provider: "openai",
        model: model.modelId,
        stopReason: "stop",
        timestamp: 2,
        content: [{ type: "text", text: "fallback answer" }],
      },
    ];

    const result = sanitizeConversationMessages(messages, {
      policy: resolveTranscriptPolicy(model),
    });

    expect(result.addedSyntheticToolResults).toBe(1);
    expect(result.messages.map((message) => message.role)).toEqual(["assistant", "tool", "assistant"]);
  });
});
