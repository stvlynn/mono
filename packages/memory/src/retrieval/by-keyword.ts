import type { MonoMemoryConfig, MemoryRecallPlan } from "@mono/shared";
import type { MemoryStore } from "../store.js";
import { selectMemoryIdsFromRoots } from "./utils.js";

export async function selectMemoryIdsByKeyword(
  memoryStore: MemoryStore,
  options: {
    query: string;
    sessionId?: string;
    config: MonoMemoryConfig;
  }
): Promise<MemoryRecallPlan> {
  const matches = await memoryStore.searchByKeyword(options.query, {
    sessionId: options.sessionId,
    limit: options.config.keywordSearchLimit
  });
  return selectMemoryIdsFromRoots(memoryStore, {
    roots: matches.map((item) => item.id),
    compactedLevelNum: options.config.compactedLevelNum,
    rawPairLevelNum: options.config.rawPairLevelNum,
    compactedCapNum: options.config.compactedCapNum,
    rawPairCapNum: options.config.rawPairCapNum
  });
}
