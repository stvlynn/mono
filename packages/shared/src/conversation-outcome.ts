import type { AssistantMessage, ConversationMessage, ToolResultMessage } from "./types.js";

export interface ConversationOutcomeOptions {
  includeToolUseAssistantText?: boolean;
  includeToolResultFallback?: boolean;
}

const FINAL_REPLY_OPEN = "[final-reply]";
const FINAL_REPLY_CLOSE = "[/final-reply]";

export function extractConversationOutcomeText(
  messages: ConversationMessage[],
  options: ConversationOutcomeOptions = {},
): string | null {
  const completedReply = extractLatestAssistantText(messages, "stop", { finalReplyOnly: true });
  if (completedReply) {
    return completedReply;
  }

  const plainStopReply = extractLatestAssistantText(messages, "stop");
  if (plainStopReply) {
    return plainStopReply;
  }

  const hasToolActivity = messages.some((message) => message.role === "tool");
  if (options.includeToolUseAssistantText && !hasToolActivity) {
    const toolUseReply = extractLatestAssistantText(messages, "tool_use");
    if (toolUseReply) {
      return toolUseReply;
    }
  }

  if (options.includeToolResultFallback) {
    return synthesizeToolResultOutcome(messages);
  }

  return null;
}

function extractLatestAssistantText(
  messages: ConversationMessage[],
  stopReason: AssistantMessage["stopReason"],
  options: { finalReplyOnly?: boolean } = {},
): string | null {
  const assistantMessages = messages.filter((message): message is AssistantMessage => message.role === "assistant");

  for (let index = assistantMessages.length - 1; index >= 0; index -= 1) {
    const message = assistantMessages[index];
    if (!message || message.stopReason !== stopReason) {
      continue;
    }

    const reply = message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text.trim())
      .filter(Boolean)
      .join("\n\n")
      .trim();
    const finalReply = extractFinalReply(reply);

    if (options.finalReplyOnly) {
      if (finalReply) {
        return finalReply;
      }
      continue;
    }

    if (reply) {
      return finalReply ?? reply;
    }
  }

  return null;
}

export function extractFinalReply(text: string): string | null {
  const start = text.indexOf(FINAL_REPLY_OPEN);
  if (start < 0) {
    return null;
  }
  const end = text.indexOf(FINAL_REPLY_CLOSE, start + FINAL_REPLY_OPEN.length);
  if (end < 0) {
    return null;
  }

  const inner = text.slice(start + FINAL_REPLY_OPEN.length, end).trim();
  return inner || null;
}

function synthesizeToolResultOutcome(messages: ConversationMessage[]): string | null {
  const toolMessages = messages
    .filter((message): message is ToolResultMessage => message.role === "tool")
    .slice(-8)
    .reverse();
  if (toolMessages.length === 0) {
    return null;
  }

  const outputs = toolMessages.map((message) => {
    const text = toolResultToText(message).trim();
    return {
      toolName: message.toolName,
      text,
      normalized: text.toLowerCase(),
    };
  });

  const toolNames = new Set(outputs.map((entry) => entry.toolName));
  const missingCommands = collectMissingCommands(outputs.map((entry) => entry.text));
  const blockedLookupCount = outputs.filter((entry) => isBlockedOrUnreliableLookup(entry.normalized)).length;
  const emptyCount = outputs.filter((entry) => entry.text.length === 0).length;

  if (missingCommands.length > 0) {
    return `I tried to check that, but this runtime is missing required commands: ${missingCommands.join(", ")}.`;
  }

  if (outputs.some((entry) => entry.normalized.includes("bad authentication data"))) {
    return "I tried to check that, but the upstream API rejected anonymous access and needs authentication.";
  }

  if (blockedLookupCount >= 2 || emptyCount >= 3) {
    return toolNames.size === 1 && toolNames.has("bash")
      ? "I tried several public lookups, but couldn't get a reliable result from this runtime."
      : "I tried several tool checks, but couldn't get a reliable result from this runtime.";
  }

  return null;
}

function toolResultToText(message: ToolResultMessage): string {
  if (typeof message.content === "string") {
    return message.content;
  }

  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function collectMissingCommands(outputs: string[]): string[] {
  const commands = new Set<string>();

  for (const output of outputs) {
    const lineScopedMatch = output.match(/line\s+\d+:\s+([a-z0-9._-]+):\s+command not found/i);
    if (lineScopedMatch?.[1]) {
      commands.add(lineScopedMatch[1].toLowerCase());
      continue;
    }

    const simpleMatch = output.match(/^([a-z0-9._-]+):\s+command not found/im);
    if (simpleMatch?.[1] && simpleMatch[1].toLowerCase() !== "bash") {
      commands.add(simpleMatch[1].toLowerCase());
    }
  }

  return [...commands.values()];
}

function isBlockedOrUnreliableLookup(output: string): boolean {
  if (!output) {
    return true;
  }

  return /\bnot found\b/.test(output)
    || /parse error/.test(output)
    || /cloudflare/.test(output)
    || /attention required/.test(output)
    || /just a moment/.test(output)
    || /client network socket disconnected/.test(output)
    || /tls connection/.test(output)
    || /fetch failed/.test(output)
    || /all failed/.test(output)
    || /timed out/.test(output);
}
