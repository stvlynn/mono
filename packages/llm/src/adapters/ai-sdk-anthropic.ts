import type { LlmRunOptions, ModelAdapter } from "./types.js";
import { runAiSdkConversation } from "./ai-sdk-runtime.js";
import { resolveModelTransport } from "./transport.js";

export const aiSdkAnthropicAdapter: ModelAdapter = {
  id: "ai-sdk-anthropic",
  supports(model) {
    return resolveModelTransport(model) === "anthropic";
  },
  async run(options: LlmRunOptions) {
    return runAiSdkConversation(options);
  }
};
