import type { MemoryRecord, MemorySearchMatch } from "@mono/shared";

export interface MemoryStore {
  count(): Promise<number>;
  getLatest(options?: {
    sessionId?: string;
    limit?: number;
    tags?: string[];
  }): Promise<string[]>;
  getById(id: string): Promise<MemoryRecord | null>;
  getByIds(ids: string[]): Promise<MemoryRecord[]>;
  getAncestors(id: string, level?: number): Promise<string[]>;
  append(record: MemoryRecord): Promise<void>;
  searchByKeyword(
    query: string,
    options?: {
      limit?: number;
      sessionId?: string;
    }
  ): Promise<MemorySearchMatch[]>;
}

export type ExecutionMemoryBackend = MemoryStore;
