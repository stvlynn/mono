import { describe, expect, it } from "vitest";
import {
  DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
  HEARTBEAT_ACK_TOKEN,
  evaluateHeartbeatReply,
} from "../packages/agent-core/src/heartbeat-response.js";
import type { ConversationMessage } from "../packages/shared/src/index.js";
import { createTestUnifiedModel, describeIfRealTestModel } from "./helpers/test-model-env.js";

const testModel = createTestUnifiedModel();

function assistantText(text: string): ConversationMessage {
  return {
    role: "assistant",
    provider: testModel.provider,
    model: testModel.modelId,
    stopReason: "stop",
    timestamp: Date.now(),
    content: [{ type: "text", text }],
  };
}

describeIfRealTestModel("heartbeat response", () => {
  it("treats a pure heartbeat ack as ack", () => {
    const result = evaluateHeartbeatReply({
      messages: [assistantText(HEARTBEAT_ACK_TOKEN)],
    });

    expect(result.status).toBe("ack");
    expect(result.visibleText).toBe("");
  });

  it("suppresses short text after a heartbeat ack", () => {
    const result = evaluateHeartbeatReply({
      messages: [assistantText(`${HEARTBEAT_ACK_TOKEN} ok`)],
      ackMaxChars: DEFAULT_HEARTBEAT_ACK_MAX_CHARS,
    });

    expect(result.status).toBe("ack");
    expect(result.visibleText).toBe("ok");
  });

  it("does not treat middle token usage as an ack", () => {
    const result = evaluateHeartbeatReply({
      messages: [assistantText(`Need attention. ${HEARTBEAT_ACK_TOKEN} appears here.`)],
    });

    expect(result.status).toBe("sent");
    expect(result.visibleText).toContain(HEARTBEAT_ACK_TOKEN);
  });

  it("marks repeated heartbeat content as duplicate", () => {
    const result = evaluateHeartbeatReply({
      messages: [assistantText("Check the failing test and rerun verification.")],
      previousNormalizedText: "Check the failing test and rerun verification.",
    });

    expect(result.status).toBe("duplicate");
  });
});
