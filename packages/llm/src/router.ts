import type { ConversationMessage, UnifiedModel } from "@mono/shared";
import {
  aiSdkAnthropicAdapter,
  aiSdkGeminiAdapter,
  aiSdkOpenAICompatibleAdapter,
  aiSdkOpenAIResponsesAdapter,
  type LlmRunOptions,
  type LlmTextStreamOptions,
  type ModelAdapter
} from "./adapters/index.js";

const ADAPTERS: ModelAdapter[] = [
  aiSdkAnthropicAdapter,
  aiSdkGeminiAdapter,
  aiSdkOpenAIResponsesAdapter,
  aiSdkOpenAICompatibleAdapter
];

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

export async function streamConversationText(options: LlmTextStreamOptions): Promise<string> {
  return getAdapterForModel(options.model).streamText(options);
}
