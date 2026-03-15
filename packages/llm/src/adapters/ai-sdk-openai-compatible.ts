import type { LlmRunOptions, ModelAdapter } from "./types.js";
import { runAiSdkConversation } from "./ai-sdk-runtime.js";
import { resolveModelTransport } from "./transport.js";

export const aiSdkOpenAICompatibleAdapter: ModelAdapter = {
  id: "ai-sdk-openai-compatible",
  supports(model) {
    return resolveModelTransport(model) === "openai-compatible";
  },
  async run(options: LlmRunOptions) {
    return runAiSdkConversation(options);
  }
};
