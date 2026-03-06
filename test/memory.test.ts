import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { MemoryRecord } from "../packages/shared/src/index.js";
import { DeterministicMemoryCompactor, FolderMemoryStore, createMemoryId, selectMemoryIdsFromRoots } from "../packages/memory/src/index.js";

function createRecord(input: Partial<MemoryRecord> = {}): MemoryRecord {
  const createdAt = input.createdAt ?? Date.now();
  return {
    id: input.id ?? createMemoryId(createdAt),
    createdAt,
    projectKey: "project",
    sessionId: input.sessionId ?? "session-a",
    branchHeadId: input.branchHeadId,
    parents: input.parents ?? [],
    children: input.children ?? [],
    referencedMemoryIds: input.referencedMemoryIds ?? [],
    input: input.input ?? "read package.json",
    compacted: input.compacted ?? ["Received request: read package.json"],
    output: input.output ?? "Summarized package.json",
    detailed: input.detailed ?? [{ type: "user", text: "read package.json" }],
    tags: input.tags ?? [],
    files: input.files ?? ["package.json"],
    tools: input.tools ?? ["read"]
  };
}

describe("memory store", () => {
  it("persists records, search hits, and ancestors", async () => {
    const root = await mkdtemp(join(tmpdir(), "mono-memory-"));
    const store = new FolderMemoryStore(root);
    const parent = createRecord({ createdAt: Date.now() - 1000, input: "inspect README", compacted: ["Read README.md"] });
    const child = createRecord({
      createdAt: Date.now(),
      input: "fix build",
      compacted: ["Ran pnpm build", "Updated packages/cli/src/main.ts"],
      parents: [parent.id],
      referencedMemoryIds: [parent.id],
      tools: ["bash", "edit"]
    });

    await store.append(parent);
    await store.append(child);

    const latest = await store.getLatest({ limit: 2 });
    const ancestors = await store.getAncestors(child.id, 1);
    const matches = await store.searchByKeyword("build");

    expect(latest[0]).toBe(child.id);
    expect(ancestors).toContain(parent.id);
    expect(matches[0]?.id).toBe(child.id);
    expect(matches[0]?.matchedLines.some((line) => line.text.includes("build"))).toBe(true);
  });

  it("selects compacted and raw ids from roots with caps", async () => {
    const root = await mkdtemp(join(tmpdir(), "mono-memory-"));
    const store = new FolderMemoryStore(root);
    const oldest = createRecord({ createdAt: Date.now() - 3000, compacted: ["oldest"], input: "oldest" });
    const middle = createRecord({ createdAt: Date.now() - 2000, compacted: ["middle"], input: "middle", parents: [oldest.id] });
    const newest = createRecord({ createdAt: Date.now() - 1000, compacted: ["newest"], input: "newest", parents: [middle.id] });

    await store.append(oldest);
    await store.append(middle);
    await store.append(newest);

    const plan = await selectMemoryIdsFromRoots(store, {
      roots: [newest.id],
      compactedLevelNum: 1,
      rawPairLevelNum: 3,
      compactedCapNum: 1,
      rawPairCapNum: 2
    });

    expect(plan.rootIds).toEqual([newest.id]);
    expect(plan.compactedIds).toHaveLength(1);
    expect(plan.rawPairIds.length).toBeGreaterThan(0);
    expect(plan.selectedIds).toEqual([...new Set([...plan.compactedIds, ...plan.rawPairIds])].sort());
  });
});

describe("deterministic memory compactor", () => {
  it("keeps request, actions, observations, and response", async () => {
    const compactor = new DeterministicMemoryCompactor();
    const result = await compactor.compact({
      userRequest: "run tests and fix failures",
      assistantOutput: "Fixed the failing import and reran tests.",
      referencedMemoryIds: [],
      trace: [
        { type: "tool_call", toolName: "bash", args: { cmd: "pnpm test" } },
        { type: "tool_result", toolName: "bash", output: "1 failing test in packages/cli" },
        { type: "tool_call", toolName: "edit", args: { file: "packages/cli/src/main.ts" } },
        { type: "tool_result", toolName: "edit", output: "updated import path" }
      ]
    });

    expect(result.rawInput).toContain("run tests");
    expect(result.rawOutput).toContain("Fixed the failing import");
    expect(result.compacted.some((line) => line.includes("bash"))).toBe(true);
    expect(result.compacted.some((line) => line.includes("Observed"))).toBe(true);
  });
});
