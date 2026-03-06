import type { UnifiedModel } from "@mono/shared";
import { runXsaiConversation, mapOpenAIThinkingLevel } from "./xsai-shared.js";
import type { LlmRunOptions, ModelAdapter } from "./types.js";

function resolveApiKey(model: UnifiedModel): string {
  const apiKey = model.apiKey ?? (model.apiKeyEnv ? process.env[model.apiKeyEnv] : undefined);
  if (!apiKey) {
    throw new Error(`Missing API key for provider ${model.provider}`);
  }
  return apiKey;
}

export const xsaiOpenAICompatibleAdapter: ModelAdapter = {
  id: "xsai-openai-compatible",
  supports(model) {
    return (model.transport ?? "xsai-openai-compatible") === "xsai-openai-compatible" && model.family === "openai-compatible";
  },
  async run(options: LlmRunOptions) {
    return runXsaiConversation(options, {
      apiKey: resolveApiKey(options.model),
      baseURL: options.model.baseURL,
      model: options.model.modelId,
      reasoningEffort: mapOpenAIThinkingLevel(options.thinkingLevel)
    });
  }
};
