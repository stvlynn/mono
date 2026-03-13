import type { ToolResultPart, ToolExecutionUpdate } from "@mono/shared";

const MAX_SUMMARY_LENGTH = 120;
const MAX_DETAIL_LENGTH = 1_000;

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function stringifyStructuredContent(parts: ToolResultPart[]): string {
  return parts
    .map((part) => (part.type === "text" ? part.text : `[image:${part.mimeType}]`))
    .join("\n")
    .trim();
}

function summarizePrimitive(value: unknown): string {
  if (typeof value === "string") {
    return truncate(collapseWhitespace(value), MAX_SUMMARY_LENGTH);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value == null) {
    return "null";
  }

  return truncate(collapseWhitespace(JSON.stringify(value)), MAX_SUMMARY_LENGTH);
}

function summarizeObjectEntries(value: Record<string, unknown>): string {
  const entries = Object.entries(value).slice(0, 3);
  if (entries.length === 0) {
    return "{}";
  }

  const summary = entries
    .map(([key, entryValue]) => `${key}=${summarizePrimitive(entryValue)}`)
    .join(" ");

  return truncate(summary, MAX_SUMMARY_LENGTH);
}

export function summarizeToolInput(value: unknown): string {
  if (typeof value === "string") {
    return truncate(collapseWhitespace(value), MAX_SUMMARY_LENGTH);
  }

  if (Array.isArray(value)) {
    return truncate(value.map((entry) => summarizePrimitive(entry)).join(", "), MAX_SUMMARY_LENGTH);
  }

  if (value && typeof value === "object") {
    return summarizeObjectEntries(value as Record<string, unknown>);
  }

  return summarizePrimitive(value);
}

export function stringifyToolContent(content: string | ToolResultPart[]): string {
  const text = typeof content === "string" ? content : stringifyStructuredContent(content);
  return text.trim();
}

export function summarizeToolContent(content: string | ToolResultPart[]): string {
  const text = stringifyToolContent(content);
  if (!text) {
    return "No output";
  }
  return truncate(collapseWhitespace(text.split("\n")[0] ?? text), MAX_SUMMARY_LENGTH);
}

export function summarizeToolUpdateDetail(update: ToolExecutionUpdate): string {
  return truncate(stringifyToolContent(update.content), MAX_DETAIL_LENGTH);
}

export function summarizeToolUpdateLine(update: ToolExecutionUpdate): string {
  const summary = summarizeToolContent(update.content);
  return summary || "Updated";
}

export function summarizeToolResultDetail(content: string | ToolResultPart[]): string | undefined {
  const detail = stringifyToolContent(content);
  return detail ? truncate(detail, MAX_DETAIL_LENGTH) : undefined;
}
