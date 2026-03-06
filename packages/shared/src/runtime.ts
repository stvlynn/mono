import { randomUUID } from "node:crypto";
import type { ConversationMessage, ToolResultPart } from "./types.js";

export function createId(): string {
  return randomUUID();
}

export function now(): number {
  return Date.now();
}

export function contentToPlainText(content: string | ToolResultPart[]): string {
  if (typeof content === "string") {
    return content;
  }

  return content
    .map((part) => (part.type === "text" ? part.text : `[image:${part.mimeType}]`))
    .join("\n");
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
