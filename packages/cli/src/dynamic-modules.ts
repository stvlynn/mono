import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Agent } from "@mono/agent-core";
import type { RetrievedContextItem } from "@mono/memory";
import type { MemoryRecord, SessionEntry } from "@mono/shared";

export async function loadOpenVikingAdapter(): Promise<{
  OpenVikingRetrievalProvider: new (...args: any[]) => {
    recallForSession(options: { sessionId: string; messages?: unknown[]; query?: string }): Promise<{
      items: RetrievedContextItem[];
      contextBlock: string;
    }>;
    health(): Promise<unknown>;
  };
  OpenVikingShadowExporter: new (...args: any[]) => {
    exportRecord(record: MemoryRecord): Promise<unknown>;
  };
}> {
  const distUrl = new URL("../../openviking-adapter/dist/index.js", import.meta.url);
  if (existsSync(fileURLToPath(distUrl))) {
    return import(distUrl.href);
  }

  const srcUrl = new URL("../../openviking-adapter/src/index.ts", import.meta.url);
  return import(srcUrl.href);
}

export async function loadSeekDbAdapter(): Promise<{
  SeekDbExecutionMemoryBackend: new (...args: any[]) => {
    append(record: MemoryRecord): Promise<void>;
    count(): Promise<number>;
  };
  SeekDbRetrievalProvider: new (...args: any[]) => {
    recallForSession(options: { sessionId: string; messages?: unknown[]; query?: string }): Promise<{
      items: RetrievedContextItem[];
      contextBlock: string;
    }>;
  };
  SeekDbSessionMirror: new (...args: any[]) => {
    countEntries(sessionId?: string): Promise<number>;
    mirrorSession(input: { sessionId: string; cwd: string; headId?: string; entries: unknown[] }): Promise<unknown>;
  };
}> {
  const distUrl = new URL("../../seekdb-adapter/dist/index.js", import.meta.url);
  if (existsSync(fileURLToPath(distUrl))) {
    return import(distUrl.href);
  }

  const srcUrl = new URL("../../seekdb-adapter/src/index.ts", import.meta.url);
  return import(srcUrl.href);
}

export async function loadSessionModule(): Promise<{
  SessionManager: new (...args: any[]) => {
    initialize(model: ReturnType<Agent["getCurrentModel"]>): Promise<void>;
    getHeadId(): string | undefined;
    readEntries(): Promise<SessionEntry[]>;
    readEntriesForHead(branchHeadId?: string): Promise<SessionEntry[]>;
  } & {
    listSessions?: never;
  };
} & {
  SessionManager: {
    listSessions(cwd: string): Promise<Array<{ sessionId: string; filePath: string; cwd: string }>>;
    rootDirFromSessionFile(filePath: string): string;
    new (options: {
      cwd: string;
      sessionId?: string;
      branchHeadId?: string;
      sessionsDir?: string;
    }): {
      initialize(model: ReturnType<Agent["getCurrentModel"]>): Promise<void>;
      getHeadId(): string | undefined;
      readEntries(): Promise<SessionEntry[]>;
      readEntriesForHead(branchHeadId?: string): Promise<SessionEntry[]>;
    };
  };
}> {
  const distUrl = new URL("../../session/dist/index.js", import.meta.url);
  if (existsSync(fileURLToPath(distUrl))) {
    return import(distUrl.href) as Promise<any>;
  }

  const srcUrl = new URL("../../session/src/index.ts", import.meta.url);
  return import(srcUrl.href) as Promise<any>;
}

export async function loadSessionEntriesForMirror(agent: Agent, sessionId?: string): Promise<{
  sessionId: string;
  cwd: string;
  headId?: string;
  entries: SessionEntry[];
}> {
  const { SessionManager } = await loadSessionModule();
  const targetSessionId = sessionId ?? agent.getSessionId();
  const sessions = await SessionManager.listSessions(process.cwd());
  const target = sessions.find((entry) => entry.sessionId === targetSessionId);
  if (!target) {
    throw new Error(`Session not found: ${targetSessionId}`);
  }

  const session = new SessionManager({
    cwd: target.cwd,
    sessionId: targetSessionId,
    branchHeadId: targetSessionId === agent.getSessionId() ? agent.getBranchHeadId() : undefined,
    sessionsDir: SessionManager.rootDirFromSessionFile(target.filePath)
  });
  await session.initialize(agent.getCurrentModel());
  return {
    sessionId: targetSessionId,
    cwd: target.cwd,
    headId: session.getHeadId(),
    entries: await session.readEntriesForHead(session.getHeadId())
  };
}
