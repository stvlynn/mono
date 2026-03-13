import { renderMemoryContext } from "@mono/memory";
import type { Agent } from "@mono/agent-core";
import type { MemoryRecord } from "@mono/shared";

export interface LocalRecallSnapshot {
  selectedIds: string[];
  compactedIds: string[];
  rawPairIds: string[];
  contextBlock: string;
}

export async function buildLocalRecallSnapshot(agent: Agent, query: string): Promise<LocalRecallSnapshot> {
  const plan = await agent.recallMemory(query);
  const records = (
    await Promise.all(plan.selectedIds.map((id) => agent.getMemoryRecord(id)))
  ).filter((record): record is MemoryRecord => record !== null);

  return {
    selectedIds: plan.selectedIds,
    compactedIds: plan.compactedIds,
    rawPairIds: plan.rawPairIds,
    contextBlock: renderMemoryContext(records, new Set(plan.compactedIds))
  };
}

export async function getMemoryRecordOrThrow(agent: Agent, id: string): Promise<MemoryRecord> {
  const record = await agent.getMemoryRecord(id);
  if (!record) {
    throw new Error(`Memory record not found: ${id}`);
  }
  return record;
}

export async function getMemoryRecordOrLatest(agent: Agent, id?: string): Promise<MemoryRecord> {
  if (id) {
    return getMemoryRecordOrThrow(agent, id);
  }
  const record = (await agent.listMemories(1))[0] ?? null;
  if (!record) {
    throw new Error("No local memory records available to export");
  }
  return record;
}
