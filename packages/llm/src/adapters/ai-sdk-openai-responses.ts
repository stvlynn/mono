import type { LlmRunOptions, ModelAdapter } from "./types.js";
import { runAiSdkConversation } from "./ai-sdk-runtime.js";
import { resolveModelTransport } from "./transport.js";

export const aiSdkOpenAIResponsesAdapter: ModelAdapter = {
  id: "ai-sdk-openai-responses",
  supports(model) {
    return resolveModelTransport(model) === "openai-responses";
  },
  async run(options: LlmRunOptions) {
    return runAiSdkConversation(options);
  }
};
