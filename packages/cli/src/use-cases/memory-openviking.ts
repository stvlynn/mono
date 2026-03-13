import type { RetrievedContextItem } from "@mono/memory";
import { createInitializedAgent, requireOpenVikingConfig } from "../runtime.js";
import { loadOpenVikingAdapter } from "../dynamic-modules.js";
import { buildLocalRecallSnapshot, getMemoryRecordOrLatest } from "./memory-shared.js";

export interface OpenVikingCompareResult {
  query: string;
  local: Awaited<ReturnType<typeof buildLocalRecallSnapshot>>;
  openViking: {
    items: RetrievedContextItem[];
    contextBlock: string;
  };
}

export interface OpenVikingStatusResult {
  url: string | undefined;
  health: unknown;
}

export async function runMemoryCompareOpenViking(query: string): Promise<OpenVikingCompareResult> {
  const agent = await createInitializedAgent();
  const local = await buildLocalRecallSnapshot(agent, query);

  const openViking = requireOpenVikingConfig(agent);
  const { OpenVikingRetrievalProvider } = await loadOpenVikingAdapter();
  const provider = new OpenVikingRetrievalProvider({ config: openViking });
  const external = await provider.recallForSession({
    sessionId: agent.getSessionId(),
    messages: agent.getMessages(),
    query
  });

  return {
    query,
    local,
    openViking: {
      items: external.items,
      contextBlock: external.contextBlock
    }
  };
}

export async function runOpenVikingStatus(): Promise<OpenVikingStatusResult> {
  const agent = await createInitializedAgent();
  const openViking = requireOpenVikingConfig(agent);
  const { OpenVikingRetrievalProvider } = await loadOpenVikingAdapter();
  const provider = new OpenVikingRetrievalProvider({ config: openViking });
  const health = await provider.health();
  return { url: openViking.url, health };
}

export async function runExportOpenViking(id?: string) {
  const agent = await createInitializedAgent();
  const openViking = requireOpenVikingConfig(agent);
  const { OpenVikingShadowExporter } = await loadOpenVikingAdapter();
  const exporter = new OpenVikingShadowExporter({ config: openViking });
  const record = await getMemoryRecordOrLatest(agent, id);
  return exporter.exportRecord(record);
}
