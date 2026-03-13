import { createGoogleGenerativeAI } from "@xsai-ext/providers/create";
import type { UnifiedModel } from "@mono/shared";
import { runXsaiConversation } from "./xsai-shared.js";
import type { LlmRunOptions, ModelAdapter } from "./types.js";
import { resolveModelTransport } from "./transport.js";

function resolveApiKey(model: UnifiedModel): string {
  const apiKey = model.apiKey ?? (model.apiKeyEnv ? process.env[model.apiKeyEnv] : undefined);
  if (!apiKey) {
    throw new Error(`Missing API key for provider ${model.provider}`);
  }
  return apiKey;
}

export const xsaiGeminiAdapter: ModelAdapter = {
  id: "xsai-gemini",
  supports(model) {
    return resolveModelTransport(model) === "gemini";
  },
  async run(options: LlmRunOptions) {
    const apiKey = resolveApiKey(options.model);
    const google = createGoogleGenerativeAI(apiKey, options.model.baseURL);
    return runXsaiConversation(options, {
      ...google.chat(options.model.modelId)
    });
  }
};
