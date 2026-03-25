import type { LlmRunOptions, LlmTextStreamOptions, ModelAdapter } from "./types.js";
import { runAiSdkConversation, streamAiSdkText } from "./ai-sdk-runtime.js";
import { resolveModelTransport } from "./transport.js";

export const aiSdkAnthropicAdapter: ModelAdapter = {
  id: "ai-sdk-anthropic",
  supports(model) {
    return resolveModelTransport(model) === "anthropic";
  },
  async run(options: LlmRunOptions) {
    return runAiSdkConversation(options);
  },
  async streamText(options: LlmTextStreamOptions) {
    return streamAiSdkText(options);
  }
};
