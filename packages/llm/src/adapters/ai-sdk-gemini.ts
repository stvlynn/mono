import type { LlmRunOptions, LlmTextStreamOptions, ModelAdapter } from "./types.js";
import { runAiSdkConversation, streamAiSdkText } from "./ai-sdk-runtime.js";
import { resolveModelTransport } from "./transport.js";

export const aiSdkGeminiAdapter: ModelAdapter = {
  id: "ai-sdk-gemini",
  supports(model) {
    return resolveModelTransport(model) === "gemini";
  },
  async run(options: LlmRunOptions) {
    return runAiSdkConversation(options);
  },
  async streamText(options: LlmTextStreamOptions) {
    return streamAiSdkText(options);
  }
};
