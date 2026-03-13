import { randomUUID } from "node:crypto";
import { toolOrUserContentToPlainText } from "./input.js";
import type { ConversationMessage, ToolResultPart } from "./types.js";

export function createId(): string {
  return randomUUID();
}

export function now(): number {
  return Date.now();
}

export function contentToPlainText(content: string | ToolResultPart[]): string {
  return toolOrUserContentToPlainText(content);
}

export function getLastAssistantText(message: ConversationMessage): string {
  if (message.role !== "assistant") {
    return "";
  }

  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}
