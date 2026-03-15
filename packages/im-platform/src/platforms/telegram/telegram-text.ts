import type { DispatchTextFormat } from "../../types.js";
import { markdownToTelegramHtml } from "./vendor/telegram-platform-adapter/format.js";
import { splitMessage } from "./vendor/telegram-platform-adapter/split-message.js";

export interface PreparedTelegramText {
  text: string;
  parseMode?: "HTML";
  fallbackText?: string;
}

export function resolveTelegramTextFormat(
  requested: DispatchTextFormat | undefined,
  fallback: DispatchTextFormat | undefined,
): DispatchTextFormat {
  return requested ?? fallback ?? "plain";
}

export function prepareTelegramTextChunks(
  text: string,
  requested: DispatchTextFormat | undefined,
  fallback: DispatchTextFormat | undefined,
): PreparedTelegramText[] {
  const format = resolveTelegramTextFormat(requested, fallback);
  return splitMessage(text, 4096).map((chunk) => prepareTelegramText(chunk, format));
}

export function prepareTelegramCaption(
  text: string | undefined,
  requested: DispatchTextFormat | undefined,
  fallback: DispatchTextFormat | undefined,
): PreparedTelegramText | undefined {
  if (!text) {
    return undefined;
  }
  const format = resolveTelegramTextFormat(requested, fallback);
  return prepareTelegramSingleText(text, format);
}

export function prepareTelegramSingleText(
  text: string,
  requested: DispatchTextFormat | undefined,
  fallback?: DispatchTextFormat | undefined,
): PreparedTelegramText {
  const format = resolveTelegramTextFormat(requested, fallback);
  return prepareTelegramText(text, format);
}

function prepareTelegramText(text: string, format: DispatchTextFormat): PreparedTelegramText {
  if (format === "plain") {
    return { text };
  }
  if (format === "html") {
    return {
      text,
      parseMode: "HTML",
      fallbackText: text,
    };
  }
  return {
    text: markdownToTelegramHtml(text),
    parseMode: "HTML",
    fallbackText: text,
  };
}
