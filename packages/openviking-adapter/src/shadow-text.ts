import type { MemoryDetailedTrace, MemoryRecord } from "@mono/shared";

export function buildAssistantShadowText(record: MemoryRecord): string {
  const compacted = record.compacted.map((line) => `- ${line}`).join("\n");
  const detailedTrace = renderDetailedTrace(record.detailed);
  return [
    record.output.trim(),
    compacted ? "\nExecution summary:\n" + compacted : "",
    detailedTrace ? "\nDetailed trace:\n" + detailedTrace : ""
  ]
    .filter(Boolean)
    .join("\n")
    .trim();
}

function renderDetailedTrace(trace: MemoryDetailedTrace[]): string {
  return trace
    .map((item) => {
      if (item.type === "user") {
        return `User: ${summarizeText(item.text)}`;
      }
      if (item.type === "assistant") {
        return `Assistant: ${summarizeText(item.text ?? item.thinking ?? "")}`;
      }
      if (item.type === "tool_call") {
        return `Tool call ${item.toolName}: ${summarizeStructuredValue(item.args)}`;
      }
      return `Tool result ${item.toolName}: ${summarizeText(item.output)}`;
    })
    .filter(Boolean)
    .join("\n");
}

function summarizeText(text: string, limit = 400): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 1)}…`;
}

function summarizeStructuredValue(value: unknown, limit = 240): string {
  try {
    return summarizeText(JSON.stringify(value), limit);
  } catch {
    return "<unserializable>";
  }
}
