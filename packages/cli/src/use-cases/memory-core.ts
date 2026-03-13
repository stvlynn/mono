import type { MemoryRecallPlan, MemoryRecord } from "@mono/shared";
import { createInitializedAgent } from "../runtime.js";
import { getMemoryRecordOrThrow } from "./memory-shared.js";

export interface MemoryStatusResult {
  enabled: boolean;
  autoInject: boolean;
  retrievalBackend: string;
  fallbackToLocal: boolean;
  storePath: string;
  v2Enabled: boolean;
  v2StorePath: string;
  v2PrimaryEntityId: string;
  v2OpenVikingSync: string;
  openViking: string;
  seekDb: string;
  records: number;
  currentSession: string;
  lastMemory: string;
}

export interface MemoryRecallResult {
  plan: MemoryRecallPlan;
  records: MemoryRecord[];
}

export async function runMemoryStatus(): Promise<MemoryStatusResult> {
  const agent = await createInitializedAgent();
  const count = await agent.countMemories();
  const records = await agent.listMemories(1);
  const config = agent.getResolvedConfig();
  return {
    enabled: config.memory.enabled,
    autoInject: config.memory.autoInject,
    retrievalBackend: config.memory.retrievalBackend,
    fallbackToLocal: config.memory.fallbackToLocalOnFailure,
    storePath: agent.getMemoryStorePath(),
    v2Enabled: config.memory.v2.enabled,
    v2StorePath: agent.getStructuredMemoryStorePath(),
    v2PrimaryEntityId: config.memory.v2.primaryEntityId,
    v2OpenVikingSync: config.memory.v2.openVikingSync,
    openViking: config.memory.openViking.enabled ? config.memory.openViking.url ?? "<missing url>" : "disabled",
    seekDb: config.memory.seekDb.enabled
      ? `${config.memory.seekDb.mode} (${config.memory.seekDb.database ?? config.memory.seekDb.embeddedPath ?? "<missing target>"})`
      : "disabled",
    records: count,
    currentSession: agent.getSessionId(),
    lastMemory: records[0]?.id ?? "<none>"
  };
}

export async function runMemoryList(limit: number): Promise<MemoryRecord[]> {
  const agent = await createInitializedAgent();
  return agent.listMemories(limit);
}

export async function runMemorySearch(query: string) {
  const agent = await createInitializedAgent();
  return agent.searchMemories(query);
}

export async function runMemoryShow(id: string): Promise<MemoryRecord> {
  const agent = await createInitializedAgent();
  return getMemoryRecordOrThrow(agent, id);
}

export async function runMemoryRecall(query?: string): Promise<MemoryRecallResult> {
  const agent = await createInitializedAgent();
  const plan = await agent.recallMemory(query);
  const records = plan.selectedIds.length > 0
    ? (await Promise.all(plan.selectedIds.map((id) => agent.getMemoryRecord(id)))).filter((record): record is MemoryRecord => record !== null)
    : [];
  return { plan, records };
}
