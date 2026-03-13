import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDefaultMemoryV2Config } from "../packages/config/src/defaults.js";
import {
  FolderStructuredMemoryStore,
  StructuredMemoryRetrievalPlanner,
  persistStructuredMemoryTurn,
  renderStructuredMemoryPackage
} from "../packages/memory/src/index.js";

describe("structured memory", () => {
  it("persists turn-derived evidence, preferences, inferences, and renders a package", async () => {
    const root = await mkdtemp(join(tmpdir(), "mono-structured-memory-"));
    const store = new FolderStructuredMemoryStore(root);
    await store.ensureLayout();

    await store.upsertSelfIdentity({
      summary: "Be direct, evidence-based, and do not overclaim.",
      nonNegotiablePrinciples: ["Prefer evidence over guesswork"]
    });
    await store.upsertProjectProfile({
      workspaceSummary: "Personal assistant runtime for long-lived collaboration.",
      durableFacts: ["Structured memory is authoritative locally."],
      collaborationNorms: ["Do not over-explain unless asked."]
    });

    const result = await persistStructuredMemoryTurn({
      config: createDefaultMemoryV2Config(),
      store,
      entityId: "primary-user",
      userMessage: "请直接一点，不要自作主张地总结，也不要安抚我。",
      assistantMessages: [
        {
          role: "assistant",
          provider: "openai",
          model: "gpt-4.1-mini",
          stopReason: "stop",
          timestamp: Date.now(),
          content: [{ type: "text", text: "后续我会更直接，也不再擅自总结。" }]
        }
      ],
      sessionId: "session-1",
      branchHeadId: "head-1"
    });

    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.preferences.items.some((item) => item.key === "prefers_directness")).toBe(true);
    expect(result.preferences.items.some((item) => item.key === "avoid_unsolicited_assumptions")).toBe(true);
    expect(result.inferences.some((item) => item.trait === "prefers_directness")).toBe(true);
    expect(result.relationshipState.collaborationMode).toBe("direct");

    const planner = new StructuredMemoryRetrievalPlanner(store, createDefaultMemoryV2Config());
    const memoryPackage = await planner.buildPackage({
      query: "direct concise summary",
      activeEntityId: "primary-user"
    });
    const rendered = renderStructuredMemoryPackage(memoryPackage);

    expect(memoryPackage.entries.some((entry) => entry.title.includes("Preference"))).toBe(true);
    expect(memoryPackage.evidence.length).toBeGreaterThan(0);
    expect(rendered).toContain("<StructuredMemoryContext");
    expect(rendered).toContain("prefers_directness");
  });
});
