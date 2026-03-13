import type { RetrievedContextItem } from "@mono/memory";
import { loadSeekDbAdapter, loadSessionEntriesForMirror } from "../dynamic-modules.js";
import { createInitializedAgent, requireSeekDbConfig } from "../runtime.js";
import { buildLocalRecallSnapshot, getMemoryRecordOrLatest } from "./memory-shared.js";

export interface SeekDbStatusResult {
  mode: "mysql" | "python-embedded";
  enabled: boolean;
  database?: string;
  embeddedPath?: string;
  executionMemoryCount: number | { error: string };
  mirroredSessionEntryCount: number | { error: string };
}

export interface SeekDbCompareResult {
  query: string;
  local: Awaited<ReturnType<typeof buildLocalRecallSnapshot>>;
  seekDb: {
    items: RetrievedContextItem[];
    contextBlock: string;
  };
}

export async function runSeekDbStatus(): Promise<SeekDbStatusResult> {
  const agent = await createInitializedAgent();
  const seekDb = requireSeekDbConfig(agent);
  const { SeekDbExecutionMemoryBackend, SeekDbSessionMirror } = await loadSeekDbAdapter();
  const backend = new SeekDbExecutionMemoryBackend({ config: seekDb });
  const sessionMirror = new SeekDbSessionMirror({ config: seekDb });
  const health = await Promise.all([
    backend.count().catch((error) => ({ error: error instanceof Error ? error.message : String(error) })),
    sessionMirror.countEntries().catch((error) => ({ error: error instanceof Error ? error.message : String(error) }))
  ]);

  return {
    mode: seekDb.mode,
    enabled: seekDb.enabled,
    database: seekDb.database,
    embeddedPath: seekDb.embeddedPath,
    executionMemoryCount: health[0],
    mirroredSessionEntryCount: health[1]
  };
}

export async function runMemoryCompareSeekDb(query: string): Promise<SeekDbCompareResult> {
  const agent = await createInitializedAgent();
  const local = await buildLocalRecallSnapshot(agent, query);

  const seekDb = requireSeekDbConfig(agent);
  const { SeekDbExecutionMemoryBackend, SeekDbRetrievalProvider, SeekDbSessionMirror } = await loadSeekDbAdapter();
  const backend = new SeekDbExecutionMemoryBackend({ config: seekDb });
  const sessionMirror = new SeekDbSessionMirror({ config: seekDb });
  const provider = new SeekDbRetrievalProvider({
    config: seekDb,
    backend,
    sessionMirror
  });
  const external = await provider.recallForSession({
    sessionId: agent.getSessionId(),
    messages: agent.getMessages(),
    query
  });

  return {
    query,
    local,
    seekDb: {
      items: external.items,
      contextBlock: external.contextBlock
    }
  };
}

export async function runExportSeekDb(id?: string) {
  const agent = await createInitializedAgent();
  const seekDb = requireSeekDbConfig(agent);
  const { SeekDbExecutionMemoryBackend } = await loadSeekDbAdapter();
  const backend = new SeekDbExecutionMemoryBackend({ config: seekDb });
  const record = await getMemoryRecordOrLatest(agent, id);
  await backend.append(record);
  return {
    recordId: record.id,
    mode: seekDb.mode,
    exported: true
  };
}

export async function runMirrorSessionSeekDb(sessionId?: string) {
  const agent = await createInitializedAgent();
  const seekDb = requireSeekDbConfig(agent);
  const { SeekDbSessionMirror } = await loadSeekDbAdapter();
  const sessionMirror = new SeekDbSessionMirror({ config: seekDb });
  const sessionInput = await loadSessionEntriesForMirror(agent, sessionId);
  return sessionMirror.mirrorSession(sessionInput);
}
