import type { MemoryRecord } from "@mono/shared";

export function findMatchedLines(record: MemoryRecord, query: string): Array<{ line: number; text: string }> {
  const loweredQuery = query.trim().toLowerCase();
  const lines = buildSearchLines(record);
  return lines
    .map((text, index) => ({
      line: index + 1,
      text
    }))
    .filter((line) => line.text.toLowerCase().includes(loweredQuery));
}

export function buildSearchLines(record: MemoryRecord): string[] {
  const lines = [record.input, record.output, ...record.compacted];
  for (const item of record.detailed) {
    if (item.type === "user") {
      lines.push(item.text);
      continue;
    }
    if (item.type === "assistant") {
      if (item.text) {
        lines.push(item.text);
      }
      if (item.thinking) {
        lines.push(item.thinking);
      }
      continue;
    }
    if (item.type === "tool_call") {
      lines.push(`${item.toolName} ${JSON.stringify(item.args)}`);
      continue;
    }
    lines.push(`${item.toolName} ${item.output}`);
  }
  return lines;
}
