import type { UnifiedModel } from "@mono/shared";
import {
  catalogModelToUnifiedModel,
  getCatalogModel,
  getCatalogProvider
} from "./catalog.js";
import { canonicalizeProviderId, createFallbackModel, normalizeModelTransport } from "./defaults.js";
import { persistProjectProfileSelection } from "./project-profile.js";
import { MonoConfigStore } from "./store.js";

export async function upsertProfile(options: {
  cwd?: string;
  profile: string;
  provider: string;
  model: string;
  baseURL: string;
  apiKeyEnv?: string;
  apiKey?: string;
  runtimeProviderKey?: string;
  setDefault?: boolean;
  bindProject?: boolean;
}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const store = new MonoConfigStore(cwd);
  const config = (await store.readGlobalConfig()) ?? await store.initGlobalConfig();
  const provider = canonicalizeProviderId(options.provider);
  const resolvedModel = await resolveProfileModel(cwd, provider, options.model, options.baseURL, options.runtimeProviderKey);

  config.mono.profiles[options.profile] = {
    provider: resolvedModel.provider,
    modelId: resolvedModel.modelId,
    baseURL: options.baseURL,
    family: resolvedModel.family,
    transport: normalizeModelTransport(resolvedModel),
    runtimeProviderKey: resolvedModel.runtimeProviderKey,
    providerFactory: resolvedModel.providerFactory,
    apiKeyRef: options.apiKey ? `local:${options.profile}` : undefined,
    apiKeyEnv: options.apiKey ? undefined : options.apiKeyEnv,
    supportsTools: resolvedModel.supportsTools,
    supportsReasoning: resolvedModel.supportsReasoning,
    contextWindow: resolvedModel.contextWindow
  };
  if (options.setDefault || !config.mono.defaultProfile) {
    config.mono.defaultProfile = options.profile;
  }
  await store.writeGlobalConfig(config);
  if (options.apiKey) {
    await store.setProfileSecret(options.profile, options.apiKey);
  }
  if (options.bindProject) {
    await persistProjectProfileSelection(options.profile, cwd);
  }
}

async function resolveProfileModel(
  cwd: string,
  provider: string,
  modelId: string,
  baseURL: string,
  runtimeProviderKey?: string
): Promise<UnifiedModel> {
  const catalogProvider = await getCatalogProvider(cwd, provider);
  const catalogModel = catalogProvider ? await getCatalogModel(cwd, provider, modelId) : undefined;

  if (catalogProvider && catalogModel) {
    if (!catalogProvider.supported || !catalogModel.supported) {
      throw new Error(
        `Provider ${provider}/${modelId} uses catalog transport ${catalogProvider.npm ?? catalogModel.npm ?? "unknown"}, which mono cannot route`
      );
    }

    return {
      ...catalogModelToUnifiedModel(catalogProvider, catalogModel, {
        runtimeProviderKey
      }),
      baseURL
    };
  }

  return createFallbackModel(provider, modelId, baseURL);
}
