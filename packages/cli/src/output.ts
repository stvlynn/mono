import { stdout as output } from "node:process";
import type { MemoryRecord } from "@mono/shared";

export function writeJson(value: unknown): void {
  output.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function writeLine(value: string): void {
  output.write(`${value}\n`);
}

export function formatMemoryRecord(record: MemoryRecord): string {
  const compacted = record.compacted.slice(0, 3).map((line) => `    - ${line}`).join("\n");
  return [
    `${record.id}  ${new Date(record.createdAt).toLocaleString()}`,
    `  files: ${record.files.join(", ") || "<none>"}`,
    `  tools: ${record.tools.join(", ") || "<none>"}`,
    `  input: ${record.input}`,
    `  output: ${record.output}`,
    compacted ? `  compacted:\n${compacted}` : "  compacted: <none>"
  ].join("\n");
}

export function formatContextPreview(label: string, lines: string[]): string {
  if (lines.length === 0) {
    return `${label}: <none>`;
  }
  return [`${label}:`, ...lines.map((line) => `  ${line}`)].join("\n");
}
