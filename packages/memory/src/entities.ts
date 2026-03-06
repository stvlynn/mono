import { randomBytes } from "node:crypto";
import type { MemoryDetailedTrace, MemoryRecord } from "@mono/shared";

export function createMemoryId(timestamp = Date.now()): string {
  const iso = new Date(timestamp).toISOString().replace(/\D/g, "").slice(0, 17);
  return `${iso}-${randomBytes(2).toString("hex")}`;
}

export function summarizeText(value: string, maxLength = 240): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact) {
    return "";
  }
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function sanitizeStructuredValue(value: unknown, maxLength = 160): string {
  if (typeof value === "string") {
    return summarizeText(value, maxLength);
  }
  try {
    return summarizeText(JSON.stringify(value), maxLength);
  } catch {
    return summarizeText(String(value), maxLength);
  }
}

export function extractFileHints(values: string[]): string[] {
  const pattern = /(?:\.?\.?\/)?[\w./-]+\.[A-Za-z0-9]+/g;
  const seen = new Set<string>();
  for (const value of values) {
    const matches = value.match(pattern) ?? [];
    for (const match of matches) {
      if (match.length > 2) {
        seen.add(match);
      }
    }
  }
  return [...seen].slice(0, 12);
}

export function extractToolNames(trace: MemoryDetailedTrace[]): string[] {
  const seen = new Set<string>();
  for (const item of trace) {
    if (item.type === "tool_call" || item.type === "tool_result") {
      seen.add(item.toolName);
    }
  }
  return [...seen];
}

export function sortMemoryRecords(records: MemoryRecord[]): MemoryRecord[] {
  return [...records].sort((a, b) => {
    if (a.createdAt !== b.createdAt) {
      return a.createdAt - b.createdAt;
    }
    return a.id.localeCompare(b.id);
  });
}
