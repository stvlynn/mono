import { MonoConfigStore, persistProjectProfileSelection, validateChannelsConfig } from "@mono/config";
import type { MonoGlobalConfig, MonoProjectConfig } from "@mono/shared";
import { getPathValue, parseConfigValue, setPathValue } from "../config-utils.js";

export async function runConfigInit() {
  const store = new MonoConfigStore(process.cwd());
  const globalConfig = await store.initGlobalConfig();
  return {
    dir: store.paths.globalDir,
    defaultProfile: globalConfig.mono.defaultProfile
  };
}

export async function runConfigMigrate(cleanup: boolean) {
  const store = new MonoConfigStore(process.cwd());
  return store.migrateLegacy(cleanup);
}

export async function runConfigGet(key: string) {
  const store = new MonoConfigStore(process.cwd());
  const config = await store.readGlobalConfig();
  return getPathValue(config, key);
}

export async function runConfigList() {
  const store = new MonoConfigStore(process.cwd());
  return store.readGlobalConfig();
}

export async function runConfigSet(key: string, value: string): Promise<{ key: string }> {
  if (/apikey/i.test(key) || /secret/i.test(key)) {
    throw new Error("Use mono auth login to manage API keys and secrets");
  }
  const store = new MonoConfigStore(process.cwd());
  const config = (await store.readGlobalConfig()) ?? await store.initGlobalConfig();
  setPathValue(config as unknown as Record<string, unknown>, key, parseConfigValue(value));
  validateChannelsConfig(config as MonoGlobalConfig);
  await store.writeGlobalConfig(config as MonoGlobalConfig);
  return { key };
}

export async function runBindProject(profile: string): Promise<MonoProjectConfig> {
  return persistProjectProfileSelection(profile, process.cwd());
}
