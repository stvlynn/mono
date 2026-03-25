import type { LlmRunOptions, LlmTextStreamOptions, ModelAdapter } from "./types.js";
import { runAiSdkConversation, streamAiSdkText } from "./ai-sdk-runtime.js";
import { resolveModelTransport } from "./transport.js";

export const aiSdkOpenAICompatibleAdapter: ModelAdapter = {
  id: "ai-sdk-openai-compatible",
  supports(model) {
    return resolveModelTransport(model) === "openai-compatible";
  },
  async run(options: LlmRunOptions) {
    return runAiSdkConversation(options);
  },
  async streamText(options: LlmTextStreamOptions) {
    return streamAiSdkText(options);
  }
};
