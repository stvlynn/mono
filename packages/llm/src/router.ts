import type { ConversationMessage, UnifiedModel } from "@mono/shared";
import {
  aiSdkAnthropicAdapter,
  aiSdkGeminiAdapter,
  aiSdkOpenAICompatibleAdapter,
  type LlmRunOptions,
  type ModelAdapter
} from "./adapters/index.js";

const ADAPTERS: ModelAdapter[] = [aiSdkAnthropicAdapter, aiSdkGeminiAdapter, aiSdkOpenAICompatibleAdapter];

export function getAdapterForModel(model: UnifiedModel): ModelAdapter {
  const adapter = ADAPTERS.find((item) => item.supports(model));
  if (!adapter) {
    throw new Error(`No adapter found for ${model.provider}/${model.modelId} (${model.family})`);
  }
  return adapter;
}

export async function runConversation(options: LlmRunOptions): Promise<ConversationMessage[]> {
  return getAdapterForModel(options.model).run(options);
}
