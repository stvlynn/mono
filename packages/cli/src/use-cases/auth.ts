import {
  MonoConfigStore,
  canonicalizeProviderId,
  getMonoConfigSummary,
  listProfiles,
  refreshModelsCatalog,
  resolveBaseURL,
  resolveMonoConfig
} from "@mono/config";
import { promptForProfileDefaults, readApiKeyFromStdin } from "../catalog-prompts.js";
import { upsertProfile } from "../profile-upsert.js";

export function resolveAuthDefaultModel(provider: string): string {
  switch (canonicalizeProviderId(provider)) {
    case "anthropic":
      return "claude-sonnet-4-5";
    case "google":
      return "gemini-2.5-pro";
    default:
      return "gpt-4.1-mini";
  }
}

export async function runAuthLogin(options: {
  profile?: string;
  provider?: string;
  model?: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  runtimeProviderKey?: string;
  withApiKey?: boolean;
  setDefault?: boolean;
  bindProject?: boolean;
  refresh?: boolean;
}): Promise<{ profile: string }> {
  if (options.refresh) {
    await refreshModelsCatalog(process.cwd());
  }
  const providerFromModel = typeof options.model === "string" && options.model.includes("/")
    ? options.model.split("/")[0]
    : undefined;
  const normalizedProvider = canonicalizeProviderId(options.provider ?? providerFromModel ?? "openai");
  const modelFromSelection = typeof options.model === "string" && options.model.includes("/")
    ? options.model.split("/").slice(1).join("/")
    : options.model;
  const values = options.withApiKey
    ? {
        profile: options.profile ?? "default",
        provider: normalizedProvider,
        model: modelFromSelection ?? resolveAuthDefaultModel(normalizedProvider),
        baseURL: options.baseUrl ?? resolveBaseURL(normalizedProvider),
        apiKeyEnv: options.apiKeyEnv,
        runtimeProviderKey: options.runtimeProviderKey,
        apiKey: await readApiKeyFromStdin()
      }
    : await promptForProfileDefaults({
        profile: options.profile,
        provider: options.provider ?? providerFromModel,
        model: modelFromSelection,
        baseURL: options.baseUrl,
        apiKeyEnv: options.apiKeyEnv,
        runtimeProviderKey: options.runtimeProviderKey,
        refresh: options.refresh
      });

  await upsertProfile({
    ...values,
    setDefault: options.setDefault,
    bindProject: options.bindProject
  });
  return { profile: values.profile };
}

export async function runAuthStatus(): Promise<{
  summary: Awaited<ReturnType<typeof getMonoConfigSummary>>;
  resolved: Awaited<ReturnType<typeof resolveMonoConfig>>;
  profiles: Awaited<ReturnType<typeof listProfiles>>;
}> {
  const summary = await getMonoConfigSummary(process.cwd());
  const resolved = await resolveMonoConfig({ cwd: process.cwd() });
  const profiles = await listProfiles(process.cwd());
  return { summary, resolved, profiles };
}

export async function runAuthLogout(profile: string, removeProfile: boolean): Promise<{ profile: string }> {
  const store = new MonoConfigStore(process.cwd());
  await store.deleteProfileSecret(profile);
  if (removeProfile) {
    const config = await store.readGlobalConfig();
    if (config?.mono.profiles[profile]) {
      delete config.mono.profiles[profile];
      if (config.mono.defaultProfile === profile) {
        config.mono.defaultProfile = Object.keys(config.mono.profiles)[0] ?? "default";
      }
      await store.writeGlobalConfig(config);
    }
  }
  return { profile };
}
