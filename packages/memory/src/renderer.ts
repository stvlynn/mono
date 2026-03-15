import { defaultPromptRenderer, type PromptRenderer } from "@mono/prompts";
import type { MemoryDetailedTrace, MemoryRecord } from "@mono/shared";
import { sanitizeStructuredValue, summarizeText } from "./entities.js";

const ASSISTANT_MEMORY_PREFIXES = [
  "Responded internally with:",
  "Responded to the user:"
];

export function renderTraceForCompaction(
  trace: MemoryDetailedTrace[],
  renderer: PromptRenderer = defaultPromptRenderer
): string {
  return trace
    .map((item) => {
      switch (item.type) {
        case "user":
          return renderer.render("memory/trace_user", {
            text: summarizeText(item.text, 400)
          });
        case "assistant":
          return renderer.render("memory/trace_assistant", {
            text: summarizeText(item.text ?? item.thinking ?? "", 400)
          });
        case "tool_call":
          return renderer.render("memory/trace_tool_call", {
            tool_name: item.toolName,
            args_text: sanitizeStructuredValue(item.args, 240)
          });
        case "tool_result":
          return renderer.render("memory/trace_tool_result", {
            tool_name: item.toolName,
            output: summarizeText(item.output, 400)
          });
      }
    })
    .filter(Boolean)
    .join("\n");
}

export function renderMemoryContext(
  records: MemoryRecord[],
  compactedIds: Set<string>,
  renderer: PromptRenderer = defaultPromptRenderer
): string {
  if (records.length === 0) {
    return "";
  }

  const compactedItems: Array<{ id: string; text: string }> = [];
  const rawPairItems: Array<{ id: string; input: string; facts: string }> = [];

  for (const record of records) {
    if (compactedIds.has(record.id)) {
      for (const step of record.compacted.filter((item) => !isAssistantDerivedMemoryStep(item)).slice(0, 6)) {
        compactedItems.push({ id: record.id, text: step });
      }
      continue;
    }
    rawPairItems.push({
      id: record.id,
      input: summarizeText(record.input, 180),
      facts: buildRawMemoryFacts(record)
    });
  }

  if (compactedItems.length === 0 && rawPairItems.length === 0) {
    return "";
  }

  return renderer.render("memory/context_block", {
    compacted_items: compactedItems,
    raw_pair_items: rawPairItems
  });
}

function isAssistantDerivedMemoryStep(step: string): boolean {
  return ASSISTANT_MEMORY_PREFIXES.some((prefix) => step.startsWith(prefix));
}

function buildRawMemoryFacts(record: MemoryRecord): string {
  const facts = [
    record.tools.length > 0 ? `Tools=${record.tools.join(", ")}` : "",
    record.files.length > 0 ? `Files=${record.files.join(", ")}` : ""
  ].filter(Boolean);

  if (facts.length === 0) {
    return "<none>";
  }

  return summarizeText(facts.join("; "), 180);
}
