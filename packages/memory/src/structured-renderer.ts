import { defaultPromptRenderer, type PromptRenderer } from "@mono/prompts";
import type { StructuredMemoryPackage } from "@mono/shared";

export function renderStructuredMemoryPackage(
  memoryPackage: StructuredMemoryPackage,
  renderer: PromptRenderer = defaultPromptRenderer
): string {
  if (memoryPackage.entries.length === 0 && memoryPackage.evidence.length === 0 && memoryPackage.externalItems.length === 0) {
    return "";
  }

  return renderer.render("memory/structured_context_block", {
    active_entity_id: memoryPackage.activeEntityId,
    entries: memoryPackage.entries,
    evidence: memoryPackage.evidence.map((item) => ({
      id: item.id,
      summary: item.summary,
      weight: item.weight.toFixed(2)
    })),
    external_items: memoryPackage.externalItems.map((item) => ({
      id: item.id,
      title: item.title,
      text: item.text,
      score: typeof item.score === "number" ? item.score.toFixed(3) : undefined
    }))
  });
}
