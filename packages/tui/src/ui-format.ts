import { SelectList, type SelectItem, type SelectListTheme } from "./legacy-compat.js";
import type { ConversationMessage, ToolExecutionUpdate } from "@mono/shared";
import type { SlashCommandMatch } from "./slash/types.js";

export const ansi = {
  bold: (value: string) => `\u001b[1m${value}\u001b[0m`,
  dim: (value: string) => `\u001b[2m${value}\u001b[0m`,
  cyan: (value: string) => `\u001b[36m${value}\u001b[0m`,
  yellow: (value: string) => `\u001b[33m${value}\u001b[0m`,
  green: (value: string) => `\u001b[32m${value}\u001b[0m`,
  red: (value: string) => `\u001b[31m${value}\u001b[0m`,
  inverse: (value: string) => `\u001b[7m${value}\u001b[0m`
};

export const selectTheme: SelectListTheme = {
  selectedPrefix: (value: string) => ansi.cyan(value),
  selectedText: (value: string) => ansi.cyan(value),
  description: (value: string) => ansi.dim(value),
  scrollInfo: (value: string) => ansi.dim(value),
  noMatch: (value: string) => ansi.dim(value)
};

export function formatMessage(message: ConversationMessage): string {
  if (message.role === "user") {
    return `> ${typeof message.content === "string" ? message.content : "[attachments]"}`;
  }

  if (message.role === "tool") {
    return `[tool:${message.toolName}] ${typeof message.content === "string" ? message.content : "[structured result]"}`;
  }

  return message.content
    .map((part) => {
      if (part.type === "text") return part.text;
      if (part.type === "thinking") return `[thinking] ${part.thinking}`;
      return `[tool-call:${part.name}] ${JSON.stringify(part.arguments)}`;
    })
    .join("\n");
}

export function summarizeToolUpdate(update: ToolExecutionUpdate): string {
  if (typeof update.content === "string") {
    return update.content;
  }

  return update.content.map((part) => (part.type === "text" ? part.text : `[image:${part.mimeType}]`)).join("\n");
}

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function createSelectList(items: SelectItem[], emptyMessage = "  No matching items"): SelectList {
  const list = new SelectList(items, 7, selectTheme);
  list.setEmptyMessage(emptyMessage);
  return list;
}

export function toSelectItems(matches: SlashCommandMatch[]): SelectItem[] {
  return matches.map((match) => ({
    value: match.command.fullName,
    label: match.command.fullName,
    description: match.command.description
  }));
}
