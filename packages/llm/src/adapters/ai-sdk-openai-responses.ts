import type { LlmRunOptions, LlmTextStreamOptions, ModelAdapter } from "./types.js";
import { runAiSdkConversation, streamAiSdkText } from "./ai-sdk-runtime.js";
import { resolveModelTransport } from "./transport.js";

export const aiSdkOpenAIResponsesAdapter: ModelAdapter = {
  id: "ai-sdk-openai-responses",
  supports(model) {
    return resolveModelTransport(model) === "openai-responses";
  },
  async run(options: LlmRunOptions) {
    return runAiSdkConversation(options);
  },
  async streamText(options: LlmTextStreamOptions) {
    return streamAiSdkText(options);
  }
};
