import type { MonoMemoryConfig, MemoryRecallPlan } from "@mono/shared";
import type { MemoryStore } from "../store.js";
import { selectMemoryIdsFromRoots } from "./utils.js";

export async function selectMemoryIdsBySession(
  memoryStore: MemoryStore,
  options: {
    sessionId: string;
    config: MonoMemoryConfig;
  }
): Promise<MemoryRecallPlan> {
  const roots = await memoryStore.getLatest({
    sessionId: options.sessionId,
    limit: options.config.latestRoots
  });

  return selectMemoryIdsFromRoots(memoryStore, {
    roots,
    compactedLevelNum: options.config.compactedLevelNum,
    rawPairLevelNum: options.config.rawPairLevelNum,
    compactedCapNum: options.config.compactedCapNum,
    rawPairCapNum: options.config.rawPairCapNum
  });
}
