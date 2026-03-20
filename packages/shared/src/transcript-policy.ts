import type { UnifiedModel } from "./types.js";

export interface TranscriptPolicy {
  repairToolCallResultPairing: boolean;
  allowSyntheticToolResults: boolean;
  dropMalformedToolCalls: boolean;
  strictAssistantToolOrdering: boolean;
}

export function resolveTranscriptPolicy(model: UnifiedModel): TranscriptPolicy {
  const strictProvider =
    model.transport === "openai-compatible"
    || model.transport === "openai-responses"
    || model.transport === "anthropic"
    || model.transport === "gemini";

  return {
    repairToolCallResultPairing: true,
    allowSyntheticToolResults: true,
    dropMalformedToolCalls: true,
    strictAssistantToolOrdering: strictProvider,
  };
}
