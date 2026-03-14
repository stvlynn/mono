import type { MonoProjectConfig } from "@mono/shared";
import { MonoConfigStore } from "./store.js";

export async function persistProjectProfileSelection(profile: string, cwd = process.cwd()): Promise<MonoProjectConfig> {
  const store = new MonoConfigStore(cwd);
  const existing = (await store.readProjectConfig()) ?? {};
  const next = selectProjectProfile(existing, profile);
  await store.writeProjectConfig(next);
  return next;
}

function selectProjectProfile(config: MonoProjectConfig, profile: string): MonoProjectConfig {
  const {
    provider: _provider,
    modelId: _modelId,
    baseURL: _baseURL,
    apiKeyRef: _apiKeyRef,
    apiKeyEnv: _apiKeyEnv,
    ...projectSettings
  } = config;

  return {
    ...projectSettings,
    profile
  };
}
