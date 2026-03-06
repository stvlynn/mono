import type { ConversationMessage } from "@mono/shared";
import type { LlmRunOptions } from "./types.js";
import { xsaiOpenAICompatibleAdapter } from "./xsai-openai-compatible.js";

export async function runXsaiOpenAIConversation(options: LlmRunOptions): Promise<ConversationMessage[]> {
  return xsaiOpenAICompatibleAdapter.run(options);
}
