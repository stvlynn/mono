import { createAnthropic } from "@xsai-ext/providers/create";
import type { UnifiedModel } from "@mono/shared";
import { mapAnthropicThinking, runXsaiConversation } from "./xsai-shared.js";
import type { LlmRunOptions, ModelAdapter } from "./types.js";

function resolveApiKey(model: UnifiedModel): string {
  const apiKey = model.apiKey ?? (model.apiKeyEnv ? process.env[model.apiKeyEnv] : undefined);
  if (!apiKey) {
    throw new Error(`Missing API key for provider ${model.provider}`);
  }
  return apiKey;
}

export const xsaiAnthropicAdapter: ModelAdapter = {
  id: "xsai-anthropic",
  supports(model) {
    return (model.transport ?? "xsai-openai-compatible") === "xsai-openai-compatible" && model.family === "anthropic";
  },
  async run(options: LlmRunOptions) {
    const apiKey = resolveApiKey(options.model);
    const anthropic = createAnthropic(apiKey, options.model.baseURL);
    return runXsaiConversation(options, {
      ...anthropic.chat(options.model.modelId, {
        thinking: mapAnthropicThinking(options.thinkingLevel)
      })
    });
  }
};
