import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDefaultMemoryV2Config } from "../packages/config/src/defaults.js";
import {
  FolderStructuredMemoryStore,
  StructuredMemoryRetrievalPlanner,
  persistStructuredMemoryTurn,
  runStructuredMemoryConsolidation,
  renderStructuredMemoryPackage
} from "../packages/memory/src/index.js";

describe("structured memory", () => {
  it("persists turn-derived observations, consolidates them, and renders a package", async () => {
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

    const observationResult = await persistStructuredMemoryTurn({
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
    const result = await runStructuredMemoryConsolidation({
      config: createDefaultMemoryV2Config(),
      store,
      entityId: "primary-user"
    });

    expect(observationResult.evidence.length).toBeGreaterThan(0);
    expect(observationResult.queueRecords.length).toBeGreaterThan(0);
    expect(observationResult.selfRuntime.currentGoals.length).toBeGreaterThan(0);
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

    expect(memoryPackage.otherGrounded.some((entry) => entry.title.includes("Preference"))).toBe(true);
    expect(memoryPackage.taskGroundedHints.some((entry) => entry.title.includes("Self Runtime"))).toBe(true);
    expect(memoryPackage.evidence.length).toBeGreaterThan(0);
    expect(rendered).toContain("<StructuredMemoryContext");
    expect(rendered).toContain("Task grounded:");
    expect(rendered).toContain("prefers_directness");
  });

  it("records unresolved conflicts and clears pending queue entries during consolidation", async () => {
    const root = await mkdtemp(join(tmpdir(), "mono-structured-conflicts-"));
    const store = new FolderStructuredMemoryStore(root);
    await store.ensureLayout();

    await store.appendSalienceQueueRecord({
      entityId: "primary-user",
      createdAt: Date.now(),
      eventId: "event-1",
      salience: 0.9,
      reason: "Prefer direct collaboration",
      status: "pending",
      observation: {
        id: "obs-1",
        key: "prefers_directness",
        summary: "Prefer direct, low-friction responses.",
        polarity: "prefer",
        confidence: 0.9,
        evidenceIds: ["ev-1"],
        contextKey: "session-1:root",
        observedAt: Date.now()
      }
    });

    await store.appendSalienceQueueRecord({
      entityId: "primary-user",
      createdAt: Date.now() + 1,
      eventId: "event-2",
      salience: 0.95,
      reason: "Directness felt too sharp",
      status: "pending",
      observation: {
        id: "obs-2",
        key: "prefers_directness",
        summary: "Prefer softer, less direct responses.",
        polarity: "avoid",
        confidence: 0.85,
        evidenceIds: ["ev-2"],
        contextKey: "session-2:root",
        observedAt: Date.now() + 1
      }
    });

    const result = await runStructuredMemoryConsolidation({
      config: createDefaultMemoryV2Config(),
      store,
      entityId: "primary-user"
    });

    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]?.field).toBe("prefers_directness");
    expect(result.processedQueue.every((item) => item.status === "processed")).toBe(true);
    expect(result.selfRuntime.currentTensions.length).toBeGreaterThan(0);
  });

  it("does not generate inference records when inference is disabled", async () => {
    const root = await mkdtemp(join(tmpdir(), "mono-structured-no-inference-"));
    const store = new FolderStructuredMemoryStore(root);
    await store.ensureLayout();

    const config = {
      ...createDefaultMemoryV2Config(),
      enableInference: false,
    };

    await persistStructuredMemoryTurn({
      config,
      store,
      entityId: "primary-user",
      userMessage: "请直接一点，不要自作主张地总结。",
      assistantMessages: [],
      sessionId: "session-1",
      branchHeadId: "head-1"
    });

    const result = await runStructuredMemoryConsolidation({
      config,
      store,
      entityId: "primary-user"
    });

    expect(result.inferences).toEqual([]);
    expect(await store.getOtherInferences("primary-user")).toEqual([]);
  });

  it("uses configured pattern and stable thresholds for preference promotion", async () => {
    const root = await mkdtemp(join(tmpdir(), "mono-structured-thresholds-"));
    const store = new FolderStructuredMemoryStore(root);
    await store.ensureLayout();

    const config = {
      ...createDefaultMemoryV2Config(),
      promotion: {
        ...createDefaultMemoryV2Config().promotion,
        minPatternOccurrences: 2,
        stablePreferenceOccurrences: 3,
      }
    };

    const contexts = ["session-1:root", "session-2:root", "session-3:root"];
    for (const [index, contextKey] of contexts.entries()) {
      await store.appendSalienceQueueRecord({
        entityId: "primary-user",
        createdAt: Date.now(),
        eventId: `event-${contextKey}`,
        salience: 0.9,
        reason: "Prefer direct collaboration",
        status: "pending",
        observation: {
          id: `obs-${contextKey}`,
          key: "prefers_directness",
          summary: "Prefer direct, low-friction responses.",
          polarity: "prefer",
          confidence: 0.9,
          evidenceIds: [`ev-${contextKey}`],
          contextKey,
          observedAt: Date.now()
        }
      });

      await runStructuredMemoryConsolidation({
        config,
        store,
        entityId: "primary-user"
      });

      const preferences = await store.getOtherPreferences("primary-user");
      const directness = preferences.items.find((item) => item.key === "prefers_directness");
      if (index === 0) {
        expect(directness?.status).toBe("observation");
      } else if (index === 1) {
        expect(directness?.status).toBe("pattern");
      }
    }

    const preferences = await store.getOtherPreferences("primary-user");
    const directness = preferences.items.find((item) => item.key === "prefers_directness");
    expect(directness?.occurrenceCount).toBe(3);
    expect(directness?.status).toBe("stable");
  });

  it("writes stable narrative updates only on the promotion run", async () => {
    const root = await mkdtemp(join(tmpdir(), "mono-structured-narrative-"));
    const store = new FolderStructuredMemoryStore(root);
    await store.ensureLayout();

    const config = createDefaultMemoryV2Config();
    await store.appendSalienceQueueRecord({
      entityId: "primary-user",
      createdAt: Date.now(),
      eventId: "event-1",
      salience: 0.9,
      reason: "Prefer direct collaboration",
      status: "pending",
      observation: {
        id: "obs-1",
        key: "prefers_directness",
        summary: "Prefer direct, low-friction responses.",
        polarity: "prefer",
        confidence: 0.9,
        evidenceIds: ["ev-1"],
        contextKey: "session-1:root",
        observedAt: Date.now()
      }
    });
    await store.appendSalienceQueueRecord({
      entityId: "primary-user",
      createdAt: Date.now() + 1,
      eventId: "event-2",
      salience: 0.9,
      reason: "Prefer direct collaboration",
      status: "pending",
      observation: {
        id: "obs-2",
        key: "prefers_directness",
        summary: "Prefer direct, low-friction responses.",
        polarity: "prefer",
        confidence: 0.91,
        evidenceIds: ["ev-2"],
        contextKey: "session-2:root",
        observedAt: Date.now() + 1
      }
    });

    await runStructuredMemoryConsolidation({
      config,
      store,
      entityId: "primary-user"
    });
    const firstNarratives = await store.listNarrativeUpdates();
    const stableNarratives = firstNarratives.filter((item) => item.event?.includes("Observed stable collaboration preference"));
    expect(stableNarratives).toHaveLength(1);

    await runStructuredMemoryConsolidation({
      config,
      store,
      entityId: "primary-user"
    });
    const secondNarratives = await store.listNarrativeUpdates();
    const repeatedStableNarratives = secondNarratives.filter((item) => item.event?.includes("Observed stable collaboration preference"));
    expect(repeatedStableNarratives).toHaveLength(1);
  });
});
