import type { MemoryRecallPlan } from "@mono/shared";
import type { MemoryStore } from "../store.js";

export function dedupeIds(ids: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

export function keepLatest(ids: string[], cap: number): string[] {
  if (cap <= 0) {
    return [];
  }
  return [...ids].sort().slice(-cap);
}

export async function selectMemoryIdsFromRoots(
  memoryStore: MemoryStore,
  options: {
    roots: string[];
    compactedLevelNum: number;
    rawPairLevelNum: number;
    compactedCapNum: number;
    rawPairCapNum: number;
  }
): Promise<MemoryRecallPlan> {
  const roots = dedupeIds(options.roots);
  const compacted = new Set<string>(roots);
  const raw = new Set<string>(roots);

  for (const rootId of roots) {
    (await memoryStore.getAncestors(rootId, options.compactedLevelNum)).forEach((id) => compacted.add(id));
    (await memoryStore.getAncestors(rootId, options.rawPairLevelNum)).forEach((id) => raw.add(id));
  }

  const compactedIds = keepLatest([...compacted], options.compactedCapNum);
  const downgraded = [...compacted].filter((id) => !compactedIds.includes(id));
  const rawPairIds = keepLatest(
    [...new Set([...raw].filter((id) => !compacted.has(id)).concat(downgraded))],
    options.rawPairCapNum
  ).filter((id) => !compactedIds.includes(id));

  return {
    rootIds: roots,
    compactedIds,
    rawPairIds,
    selectedIds: [...new Set([...compactedIds, ...rawPairIds])].sort()
  };
}
