import type { MemoryRecord, MemorySearchMatch, MonoSeekDbConfig, SessionEntry } from "@mono/shared";

export interface SeekDbRunner {
  health(): Promise<unknown>;
  execute(statements: string[]): Promise<void>;
  queryRows(sql: string): Promise<string[]>;
}

export interface SeekDbConnectionOptions {
  config: MonoSeekDbConfig;
  runner?: SeekDbRunner;
}

export interface SeekDbRetrievalOptions extends SeekDbConnectionOptions {
  limit?: number;
}

export interface SeekDbSessionSearchMatch {
  id: string;
  summary: string;
}

export interface SeekDbSessionMirrorResult {
  sessionId: string;
  mirroredEntries: number;
  headId?: string;
  mode: MonoSeekDbConfig["mode"];
}

export interface SeekDbHealthSummary {
  mode: MonoSeekDbConfig["mode"];
  health: unknown;
  executionMemoryCount?: number;
  mirroredSessionEntryCount?: number;
}

export interface SeekDbSearchResult {
  memories: Array<{
    record: MemoryRecord;
    match: MemorySearchMatch;
  }>;
  sessionEntries: SeekDbSessionSearchMatch[];
}

export interface SeekDbSessionMirrorInput {
  sessionId: string;
  cwd: string;
  headId?: string;
  entries: SessionEntry[];
}
