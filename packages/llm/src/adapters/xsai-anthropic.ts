import { runAnthropicMessagesConversation } from "./anthropic-runtime.js";
import type { LlmRunOptions, ModelAdapter } from "./types.js";
import { resolveModelTransport } from "./transport.js";

export const xsaiAnthropicAdapter: ModelAdapter = {
  id: "xsai-anthropic",
  supports(model) {
    return resolveModelTransport(model) === "anthropic";
  },
  async run(options: LlmRunOptions) {
    return runAnthropicMessagesConversation(options);
  }
};
