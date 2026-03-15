import type { LlmRunOptions, ModelAdapter } from "./types.js";
import { runAiSdkConversation } from "./ai-sdk-runtime.js";
import { resolveModelTransport } from "./transport.js";

export const aiSdkGeminiAdapter: ModelAdapter = {
  id: "ai-sdk-gemini",
  supports(model) {
    return resolveModelTransport(model) === "gemini";
  },
  async run(options: LlmRunOptions) {
    return runAiSdkConversation(options);
  }
};
