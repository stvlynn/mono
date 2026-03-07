import type { ConversationMessage, MemoryRecallPlan, MonoMemoryConfig } from "@mono/shared";
import { renderMemoryContext } from "./renderer.js";
import type { MemoryStore } from "./store.js";
import { selectMemoryIdsByKeyword } from "./retrieval/by-keyword.js";
import { selectMemoryIdsBySession } from "./retrieval/by-session.js";

export interface RetrievedContextItem {
  id: string;
  source: "local" | "openviking" | "seekdb";
  kind: "memory" | "resource" | "skill";
  title: string;
  text: string;
  uri?: string;
  score?: number;
}

export interface RetrievedContext {
  source: "local" | "openviking" | "seekdb";
  contextBlock: string;
  items: RetrievedContextItem[];
  localPlan?: MemoryRecallPlan;
}

export interface MemoryRetrievalProvider {
  recallForSession(options: {
    sessionId: string;
    messages?: ConversationMessage[];
    query?: string;
  }): Promise<RetrievedContext>;
  recallForQuery(options: {
    query: string;
    sessionId?: string;
    messages?: ConversationMessage[];
  }): Promise<RetrievedContext>;
}

export class LocalMemoryRetrievalProvider implements MemoryRetrievalProvider {
  constructor(
    private readonly memoryStore: MemoryStore,
    private readonly config: MonoMemoryConfig
  ) {}

  async recallForSession(options: {
    sessionId: string;
    messages?: ConversationMessage[];
    query?: string;
  }): Promise<RetrievedContext> {
    const plan = options.query?.trim()
      ? await selectMemoryIdsByKeyword(this.memoryStore, {
          query: options.query,
          sessionId: options.sessionId,
          config: this.config
        })
      : await selectMemoryIdsBySession(this.memoryStore, {
          sessionId: options.sessionId,
          config: this.config
        });
    return this.buildRetrievedContext(plan);
  }

  async recallForQuery(options: {
    query: string;
    sessionId?: string;
    messages?: ConversationMessage[];
  }): Promise<RetrievedContext> {
    const plan = await selectMemoryIdsByKeyword(this.memoryStore, {
      query: options.query,
      sessionId: options.sessionId,
      config: this.config
    });
    return this.buildRetrievedContext(plan);
  }

  private async buildRetrievedContext(plan: MemoryRecallPlan): Promise<RetrievedContext> {
    const records = await this.memoryStore.getByIds(plan.selectedIds);
    return {
      source: "local",
      contextBlock: renderMemoryContext(records, new Set(plan.compactedIds)),
      items: records.map((record) => ({
        id: record.id,
        source: "local",
        kind: "memory",
        title: record.id,
        text: record.compacted[0] ?? record.output ?? record.input
      })),
      localPlan: plan
    };
  }
}
