import { copyFile, writeFile } from "node:fs/promises";
import type { MemoryRecallPlan, MemoryRecord } from "@mono/shared";
import { createFallbackModel } from "@mono/config";
import { readJsonLines, type SessionEntry, type UnifiedModel } from "@mono/shared";
import { createInitializedAgent } from "../runtime.js";
import { getMemoryRecordOrThrow } from "./memory-shared.js";
import { SessionManager, repairLinearSessionTranscript } from "@mono/session";

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
  v2CurrentGoals: number;
  v2CurrentTensions: number;
  v2OpenQuestions: number;
  v2FrictionPatterns: number;
  v2PendingQueue: number;
  v2AutonomyQueue: number;
  v2FeedbackSignals: number;
  v2HeartbeatDecisions: number;
  v2HeartbeatReplies: number;
  v2Conflicts: number;
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

export interface StructuredMemoryInspectResult {
  selfRuntime: Awaited<ReturnType<import("@mono/agent-core").Agent["inspectStructuredMemory"]>>["selfRuntime"];
  learningState: Awaited<ReturnType<import("@mono/agent-core").Agent["inspectStructuredMemory"]>>["learningState"];
  conflicts: Awaited<ReturnType<import("@mono/agent-core").Agent["inspectStructuredMemory"]>>["conflicts"];
  pendingQueue: Awaited<ReturnType<import("@mono/agent-core").Agent["inspectStructuredMemory"]>>["pendingQueue"];
  autonomyQueue: Awaited<ReturnType<import("@mono/agent-core").Agent["inspectStructuredMemory"]>>["autonomyQueue"];
  feedbackSignals: Awaited<ReturnType<import("@mono/agent-core").Agent["inspectStructuredMemory"]>>["feedbackSignals"];
  heartbeatDecisions: Awaited<ReturnType<import("@mono/agent-core").Agent["inspectStructuredMemory"]>>["heartbeatDecisions"];
  heartbeatReplies: Awaited<ReturnType<import("@mono/agent-core").Agent["inspectStructuredMemory"]>>["heartbeatReplies"];
  memoryPackage: Awaited<ReturnType<import("@mono/agent-core").Agent["inspectStructuredMemory"]>>["memoryPackage"];
}

export interface MemoryHeartbeatResult {
  decision: Awaited<ReturnType<import("@mono/agent-core").Agent["runHeartbeatOnce"]>>["decision"];
  triggeredIntent?: Awaited<ReturnType<import("@mono/agent-core").Agent["runHeartbeatOnce"]>>["triggeredIntent"];
}

export interface MemoryRepairTranscriptsResult {
  scanned: number;
  modified: number;
  skipped: number;
  sessions: Array<{
    sessionId: string;
    filePath: string;
    modified: boolean;
    skippedReason?: string;
    backupPath?: string;
    addedSyntheticToolResults: number;
    droppedOrphanToolResults: number;
    droppedMalformedToolCalls: number;
    droppedAssistantMessages: number;
  }>;
}

export async function runMemoryStatus(): Promise<MemoryStatusResult> {
  const agent = await createInitializedAgent();
  const count = await agent.countMemories();
  const records = await agent.listMemories(1);
  const config = agent.getResolvedConfig();
  const entityId = config.memory.v2.primaryEntityId;
  const [structured, structuredCounts] = await Promise.all([
    agent.inspectStructuredMemory(entityId),
    agent.countStructuredMemoryState(entityId),
  ]);
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
    v2CurrentGoals: structured.selfRuntime.currentGoals.length,
    v2CurrentTensions: structured.selfRuntime.currentTensions.length,
    v2OpenQuestions: structured.selfRuntime.openQuestions.length,
    v2FrictionPatterns: structured.selfRuntime.frictionPatterns.length,
    v2PendingQueue: structuredCounts.pendingQueue,
    v2AutonomyQueue: structuredCounts.autonomyQueue,
    v2FeedbackSignals: structuredCounts.feedbackSignals,
    v2HeartbeatDecisions: structuredCounts.heartbeatDecisions,
    v2HeartbeatReplies: structuredCounts.heartbeatReplies,
    v2Conflicts: structuredCounts.conflicts,
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

export async function runStructuredMemoryInspect(entityId?: string): Promise<StructuredMemoryInspectResult> {
  const agent = await createInitializedAgent();
  return agent.inspectStructuredMemory(entityId);
}

export async function runMemoryHeartbeat(): Promise<MemoryHeartbeatResult> {
  const agent = await createInitializedAgent();
  return agent.runHeartbeatOnce();
}

export async function runMemoryRepairTranscripts(sessionId?: string): Promise<MemoryRepairTranscriptsResult> {
  const sessions = await SessionManager.listSessions(process.cwd());
  const selectedSessions = sessionId
    ? sessions.filter((session) => session.sessionId === sessionId)
    : sessions;

  const results: MemoryRepairTranscriptsResult["sessions"] = [];
  for (const session of selectedSessions) {
    const entries = await readJsonLines<SessionEntry>(session.filePath);
    const model = modelFromSessionMetadata(entries.find((entry) => entry.entryType === "metadata")?.payload);
    const repaired = repairLinearSessionTranscript(entries, model);
    const result = {
      sessionId: session.sessionId,
      filePath: session.filePath,
      modified: repaired.report.modified,
      skippedReason: repaired.report.skippedReason,
      backupPath: undefined as string | undefined,
      addedSyntheticToolResults: repaired.report.addedSyntheticToolResults,
      droppedOrphanToolResults: repaired.report.droppedOrphanToolResults,
      droppedMalformedToolCalls: repaired.report.droppedMalformedToolCalls,
      droppedAssistantMessages: repaired.report.droppedAssistantMessages,
    };

    if (repaired.report.modified) {
      const backupPath = `${session.filePath}.bak`;
      await copyFile(session.filePath, backupPath);
      await writeFile(
        session.filePath,
        `${repaired.entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
        "utf8"
      );
      result.backupPath = backupPath;
    }

    results.push(result);
  }

  return {
    scanned: selectedSessions.length,
    modified: results.filter((item) => item.modified).length,
    skipped: results.filter((item) => item.skippedReason).length,
    sessions: results,
  };
}

function modelFromSessionMetadata(metadata: unknown): UnifiedModel {
  const payload = (metadata ?? {}) as {
    provider?: string;
    model?: string;
    family?: UnifiedModel["family"];
    transport?: UnifiedModel["transport"];
    runtimeProviderKey?: UnifiedModel["runtimeProviderKey"];
    baseURL?: string;
  };
  const provider = payload.provider?.trim() || "openai";
  const modelId = payload.model?.trim() || "unknown-model";
  const fallback = createFallbackModel(provider, modelId, payload.baseURL);

  return {
    ...fallback,
    family: payload.family ?? fallback.family,
    transport: payload.transport ?? fallback.transport,
    runtimeProviderKey: payload.runtimeProviderKey ?? fallback.runtimeProviderKey,
    baseURL: payload.baseURL ?? fallback.baseURL,
  };
}
