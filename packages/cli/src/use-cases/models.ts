import { canonicalizeProviderId, refreshModelsCatalog } from "@mono/config";
import { ModelRegistry } from "@mono/llm";
import type { UnifiedModel } from "@mono/shared";

export interface ModelsListProfile {
  name: string;
  model: UnifiedModel;
}

export interface ModelsListResult {
  models: UnifiedModel[];
  profiles: ModelsListProfile[];
}

export async function runModelsList(provider?: string, refresh?: boolean): Promise<ModelsListResult> {
  if (refresh) {
    await refreshModelsCatalog(process.cwd());
  }
  const registry = new ModelRegistry({ cwd: process.cwd() });
  await registry.load();
  const normalizedProvider = provider ? canonicalizeProviderId(provider) : undefined;
  return {
    models: registry.list().filter((item) => !normalizedProvider || item.provider === normalizedProvider),
    profiles: registry.listProfiles()
  };
}
