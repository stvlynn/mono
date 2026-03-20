import { resolveTranscriptPolicy, sanitizeConversationMessages, type ConversationMessage, type UnifiedModel } from "@mono/shared";

export function guardMessagesBeforeSessionPersist(input: {
  model: UnifiedModel;
  messages: ConversationMessage[];
  allowedToolNames?: Iterable<string>;
}): ConversationMessage[] {
  return sanitizeConversationMessages(input.messages, {
    policy: resolveTranscriptPolicy(input.model),
    allowedToolNames: input.allowedToolNames,
  }).messages;
}
