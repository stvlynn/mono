import type { AssistantMessage, ConversationMessage, TaskResult } from "@mono/shared";

export function formatTelegramChatReply(result: TaskResult): string {
  return extractLatestAssistantReply(result.messages) ?? buildTelegramChatFallback(result);
}

function extractLatestAssistantReply(messages: ConversationMessage[]): string | null {
  const assistantMessages = messages.filter((message): message is AssistantMessage => message.role === "assistant");

  for (let index = assistantMessages.length - 1; index >= 0; index -= 1) {
    const message = assistantMessages[index];
    if (!message || message.stopReason === "tool_use") {
      continue;
    }

    const reply = message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join("\n\n")
      .trim();

    if (reply) {
      return reply;
    }
  }

  return null;
}

function buildTelegramChatFallback(result: TaskResult): string {
  if (result.status === "aborted") {
    return "Request cancelled.";
  }

  if (result.status === "blocked") {
    return "I got stuck and need a different approach.";
  }

  if (result.status === "incomplete") {
    return "I couldn't verify that yet.";
  }

  return "Done.";
}
