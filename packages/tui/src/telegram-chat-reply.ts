import { splitTelegramMessageText } from "@mono/im-platform";
import type { AssistantMessage, ConversationMessage, TaskResult } from "@mono/shared";
import type { TelegramChatResponse } from "@mono/telegram-control";

const TELEGRAM_STICKER_TAG_PREFIX = "[telegram-sticker:";
const TELEGRAM_STICKER_FILE_TAG_PREFIX = "[telegram-sticker-file:";
const TELEGRAM_STICKER_TAG_RE = /(?:^|\n)\[telegram-sticker:([^\]\n]+)\]\s*$/u;
const TELEGRAM_STICKER_FILE_TAG_RE = /(?:^|\n)\[telegram-sticker-file:([^\]\n]+)\]\s*$/u;
const TELEGRAM_MULTI_MESSAGE_SOFT_LIMIT = 1200;

export function formatTelegramChatReply(result: TaskResult): string {
  if (result.channelDelivery?.nativeActionRequired && !result.channelDelivery.satisfied) {
    return buildTelegramNativeActionFallback(result);
  }
  const response = formatTelegramChatResponse(result);
  return response.messages
    .map((message) => message.text)
    .find(Boolean)
    ?? (response.sticker ? "" : buildTelegramChatFallback(result));
}

export function formatTelegramChatResponse(result: TaskResult): TelegramChatResponse {
  if (result.channelDelivery?.nativeActionRequired && !result.channelDelivery.satisfied) {
    return {
      messages: [{ text: buildTelegramNativeActionFallback(result), format: "markdown" }],
    };
  }

  const latestReply = extractLatestAssistantReply(result.messages);
  if (!latestReply) {
    return {
      messages: [{ text: buildTelegramChatFallback(result), format: "markdown" }],
    };
  }

  const metadata = extractTelegramReplyMetadata(latestReply);
  const messages = splitTelegramReplyMessages(metadata.text).map((text) => ({
    text,
    format: "markdown" as const,
  }));

  return {
    messages: messages.length > 0
      ? messages
      : (metadata.stickerFileId || metadata.stickerEmoji)
        ? []
        : [{ text: buildTelegramChatFallback(result), format: "markdown" }],
    ...(metadata.stickerFileId
      ? { sticker: { fileId: metadata.stickerFileId } }
      : metadata.stickerEmoji
        ? { sticker: { emoji: metadata.stickerEmoji } }
        : {}),
  };
}

export function sanitizeTelegramReplyPreview(text: string): string {
  return stripTelegramReplyMetadataSuffix(text).trimEnd();
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

function extractTelegramReplyMetadata(text: string): { text: string; stickerEmoji?: string; stickerFileId?: string } {
  const fileMatch = TELEGRAM_STICKER_FILE_TAG_RE.exec(text.trimEnd());
  if (fileMatch?.[1]?.trim()) {
    return {
      text: stripTelegramReplyMetadataSuffix(text).trim(),
      stickerFileId: fileMatch[1].trim(),
    };
  }

  const stripped = stripTelegramReplyMetadataSuffix(text).trim();
  const match = TELEGRAM_STICKER_TAG_RE.exec(text.trimEnd());
  const stickerEmoji = match?.[1]?.trim();

  return {
    text: stripped,
    ...(stickerEmoji ? { stickerEmoji } : {}),
  };
}

function stripTelegramReplyMetadataSuffix(text: string): string {
  const complete = text
    .replace(TELEGRAM_STICKER_FILE_TAG_RE, "")
    .replace(TELEGRAM_STICKER_TAG_RE, "")
    .trimEnd();
  const partialIndex = complete.lastIndexOf(`\n${TELEGRAM_STICKER_TAG_PREFIX}`);
  const partialFileIndex = complete.lastIndexOf(`\n${TELEGRAM_STICKER_FILE_TAG_PREFIX}`);
  const cutIndex = [partialIndex, partialFileIndex]
    .filter((value) => value >= 0)
    .reduce((lowest, value) => lowest < 0 ? value : Math.min(lowest, value), -1);
  if (cutIndex >= 0) {
    return complete.slice(0, cutIndex);
  }
  if (complete.startsWith(TELEGRAM_STICKER_TAG_PREFIX) || complete.startsWith(TELEGRAM_STICKER_FILE_TAG_PREFIX)) {
    return "";
  }
  return complete;
}

function splitTelegramReplyMessages(text: string): string[] {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }

  const sections = splitMarkdownSections(normalized);
  if (sections.length === 0) {
    return splitTelegramMessageText(normalized);
  }

  const messages: string[] = [];
  let current = "";

  const flushCurrent = () => {
    const next = current.trim();
    if (next) {
      messages.push(next);
    }
    current = "";
  };

  for (const section of sections) {
    if (section.length > 4096) {
      flushCurrent();
      messages.push(...splitTelegramMessageText(section));
      continue;
    }

    const candidate = current ? `${current}\n\n${section}` : section;
    if (current && candidate.length > TELEGRAM_MULTI_MESSAGE_SOFT_LIMIT) {
      flushCurrent();
      current = section;
      continue;
    }
    current = candidate;
  }

  flushCurrent();
  return messages.flatMap((message) => splitTelegramMessageText(message));
}

function splitMarkdownSections(text: string): string[] {
  const lines = text.split("\n");
  const sections: string[] = [];
  const current: string[] = [];
  let inFence = false;

  const flush = () => {
    const section = current.join("\n").trim();
    if (section) {
      sections.push(section);
    }
    current.length = 0;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!inFence && trimmed === "") {
      flush();
      continue;
    }

    current.push(line);
    if (trimmed.startsWith("```")) {
      inFence = !inFence;
    }
  }

  flush();
  return sections;
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

function buildTelegramNativeActionFallback(result: TaskResult): string {
  const action = result.channelDelivery?.action?.trim();
  if (action) {
    return `I couldn't complete the requested ${action} action yet.`;
  }

  return "I couldn't complete the requested channel-native action yet.";
}
