import type {
  MonoGlobalConfig,
  MonoConfigSummary,
  MonoMemoryConfig,
  MonoProfileConfig,
  MonoProjectConfig,
  MonoSecretsConfig,
  ResolvedMonoConfig,
  UnifiedModel
} from "@mono/shared";
import { readJsonFile } from "@mono/shared";
import { catalogModelToUnifiedModel, getCatalogModel, getCatalogProvider, getModelsCatalog, listCatalogModels } from "./catalog.js";
import {
  canonicalizeProviderId,
  createDefaultGlobalConfig,
  createDefaultMemoryConfig,
  createDefaultSeekDbConfig,
  createFallbackModel,
  getBuiltinModels,
  isSupportedUnifiedModel,
  modelToProfile,
  normalizeModelTransport,
  profileToModel,
  resolveBaseURL
} from "./defaults.js";
import { MonoConfigStore } from "./store.js";

export interface ResolveConfigOptions {
  cwd?: string;
  modelSelection?: string;
  profileSelection?: string;
  baseURLOverride?: string;
}

export interface ProfileRecord {
  name: string;
  profile: MonoProfileConfig;
  source: ResolvedMonoConfig["source"]["profile"];
}

interface ResolverConfigSources {
  globalConfig?: MonoGlobalConfig;
  legacyAgentsGlobalConfig?: MonoGlobalConfig;
  legacyProfiles?: Record<string, MonoProfileConfig>;
  legacyAgentsProjectConfig?: MonoProjectConfig;
}

export async function listProfiles(cwd = process.cwd()): Promise<ProfileRecord[]> {
  const store = new MonoConfigStore(cwd);
  const sources = await loadResolverSources(store);
  const profilesSource = resolveProfileMap(sources);
  const source = resolveProfileMapSource(sources);

  return Object.entries(profilesSource)
    .map(([name, profile]) => ({ name, profile, source }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function resolveMonoConfig(options: ResolveConfigOptions = {}): Promise<ResolvedMonoConfig> {
  const cwd = options.cwd ?? process.cwd();
  const store = new MonoConfigStore(cwd);
  const sources = await loadResolverSources(store);
  const effectiveGlobal = resolveEffectiveGlobalConfig(sources);
  const projectConfig = (await store.readProjectConfig()) ?? sources.legacyAgentsProjectConfig ?? await loadLegacyProjectConfig(store, sources.legacyProfiles);
  const secrets = (await store.readSecrets()) ?? await readJsonFile<MonoSecretsConfig>(store.paths.legacyGlobalSecretsPath);

  const envProfile = process.env.MONO_PROFILE;
  const envModel = process.env.MONO_MODEL;
  const envBaseURL = process.env.MONO_BASE_URL;
  const directApiKey = process.env.MONO_API_KEY;

  const requestedProfile = options.profileSelection ?? envProfile ?? projectConfig?.profile ?? effectiveGlobal.mono.defaultProfile;
  const requestedModel = options.modelSelection ?? envModel;

  let source = resolveSelectedProfileSource({
    requestedProfile,
    cliProfileSelection: options.profileSelection,
    envProfile,
    projectConfig,
    sources
  });

  let model: UnifiedModel;
  let profileName = requestedProfile || "default";
  const profile = requestedProfile ? effectiveGlobal.mono.profiles[requestedProfile] : undefined;
  let resolvedProfile = profile;

  if (requestedModel) {
    model = await selectionToModel(cwd, requestedModel, options.baseURLOverride ?? envBaseURL ?? projectConfig?.baseURL);
    profileName =
      options.profileSelection
      ?? envProfile
      ?? `${model.provider}/${model.modelId}`;
    source = options.modelSelection ? "cli" : envModel ? "env" : source;
  } else if (profile) {
    resolvedProfile = await normalizeProfileWithCatalog(
      cwd,
      applyProjectOverride(profile, projectConfig, options.baseURLOverride ?? envBaseURL),
      requestedProfile
    );
    model = profileToModel(resolvedProfile);
  } else {
    const builtin = getBuiltinModels()[0];
    model = {
      ...builtin,
      baseURL: options.baseURLOverride ?? envBaseURL ?? builtin.baseURL
    };
    profileName = "default";
  }

  ensureSupportedModel(model, requestedProfile ?? profileName);

  const apiKey = directApiKey
    ?? (resolvedProfile?.apiKeyRef ? resolveApiKeyRef(resolvedProfile.apiKeyRef, secrets) : undefined)
    ?? (projectConfig?.apiKeyRef ? resolveApiKeyRef(projectConfig.apiKeyRef, secrets) : undefined)
    ?? (projectConfig?.apiKeyEnv && looksLikeInlineApiKey(projectConfig.apiKeyEnv) ? projectConfig.apiKeyEnv : undefined)
    ?? (resolvedProfile?.apiKeyEnv && looksLikeInlineApiKey(resolvedProfile.apiKeyEnv) ? resolvedProfile.apiKeyEnv : undefined)
    ?? (projectConfig?.apiKeyEnv ? process.env[projectConfig.apiKeyEnv] : undefined)
    ?? (resolvedProfile?.apiKeyEnv ? process.env[resolvedProfile.apiKeyEnv] : undefined)
    ?? (model.apiKeyEnv ? process.env[model.apiKeyEnv] : undefined);

  const apiKeySource: ResolvedMonoConfig["source"]["apiKey"] = directApiKey
    ? "env"
    : resolvedProfile?.apiKeyRef || projectConfig?.apiKeyRef
      ? apiKey ? "local-secrets" : "none"
      : looksLikeInlineApiKey(projectConfig?.apiKeyEnv) || looksLikeInlineApiKey(resolvedProfile?.apiKeyEnv)
        ? apiKey ? "config-inline" : "none"
      : resolvedProfile?.apiKeyEnv || projectConfig?.apiKeyEnv || model.apiKeyEnv
        ? apiKey ? "provider-env" : "none"
        : "none";

  return {
    profileName,
    model: {
      ...model,
      apiKey,
      baseURL: options.baseURLOverride ?? envBaseURL ?? model.baseURL
    },
    memory: resolveMemoryConfig({
      globalConfig: effectiveGlobal,
      projectConfig,
      store
    }),
    apiKey,
    source: {
      profile: source,
      apiKey: apiKeySource
    }
  };
}

export async function getMonoConfigSummary(cwd = process.cwd()): Promise<MonoConfigSummary> {
  const store = new MonoConfigStore(cwd);
  const sources = await loadResolverSources(store);
  let resolvedMemoryDir = store.paths.projectMemoryDir;
  let resolvedProfileName: string | undefined;
  try {
    const resolved = await resolveMonoConfig({ cwd });
    resolvedMemoryDir = resolved.memory.storePath;
    resolvedProfileName = resolved.profileName;
  } catch {
    // Keep config summary available even when the current default profile is invalid.
  }
  return {
    configDir: store.paths.globalDir,
    globalConfigPath: store.paths.globalConfigPath,
    projectConfigPath: store.paths.projectConfigPath,
    sessionsDir: store.paths.globalSessionsDir,
    memoryDir: resolvedMemoryDir,
    defaultProfile:
      sources.globalConfig?.mono.defaultProfile
      ?? sources.legacyAgentsGlobalConfig?.mono?.defaultProfile
      ?? Object.keys(sources.legacyProfiles ?? {}).at(0),
    resolvedProfile: resolvedProfileName,
    hasAnyProfiles:
      Object.keys(resolveProfileMap(sources)).length > 0
  };
}

async function loadResolverSources(store: MonoConfigStore): Promise<ResolverConfigSources> {
  const legacyAgentsProjectConfig = await readJsonFile<{ version?: number; mono?: MonoProjectConfig } | MonoProjectConfig>(
    store.paths.legacyProjectConfigPath
  );

  return {
    globalConfig: await store.readGlobalConfig(),
    legacyAgentsGlobalConfig: await readJsonFile<MonoGlobalConfig>(store.paths.legacyGlobalConfigPath),
    legacyProfiles: await loadLegacyProfiles(store),
    legacyAgentsProjectConfig: unwrapProjectConfig(legacyAgentsProjectConfig)
  };
}

function resolveProfileMap(sources: ResolverConfigSources): Record<string, MonoProfileConfig> {
  return (
    sources.globalConfig?.mono.profiles
    ?? sources.legacyAgentsGlobalConfig?.mono?.profiles
    ?? sources.legacyProfiles
    ?? createDefaultGlobalConfig().mono.profiles
  );
}

function resolveProfileMapSource(sources: ResolverConfigSources): ResolvedMonoConfig["source"]["profile"] {
  if (sources.globalConfig) {
    return "global-mono";
  }
  if (sources.legacyAgentsGlobalConfig?.mono?.profiles) {
    return "legacy-global-agents";
  }
  if (sources.legacyProfiles) {
    return "legacy-global-mono-models";
  }
  return "builtin";
}

function resolveEffectiveGlobalConfig(sources: ResolverConfigSources): MonoGlobalConfig {
  if (sources.globalConfig) {
    return sources.globalConfig;
  }
  if (sources.legacyAgentsGlobalConfig) {
    return sources.legacyAgentsGlobalConfig;
  }

  const defaultConfig = createDefaultGlobalConfig();
  return {
    ...defaultConfig,
    mono: {
      ...defaultConfig.mono,
      profiles: sources.legacyProfiles ?? defaultConfig.mono.profiles,
      defaultProfile: Object.keys(sources.legacyProfiles ?? {}).at(0) ?? defaultConfig.mono.defaultProfile
    }
  };
}

function resolveSelectedProfileSource(options: {
  requestedProfile?: string;
  cliProfileSelection?: string;
  envProfile?: string;
  projectConfig?: MonoProjectConfig;
  sources: ResolverConfigSources;
}): ResolvedMonoConfig["source"]["profile"] {
  const { requestedProfile, cliProfileSelection, envProfile, projectConfig, sources } = options;

  if (requestedProfile && cliProfileSelection === requestedProfile) {
    return "cli";
  }
  if (requestedProfile && envProfile === requestedProfile) {
    return "env";
  }
  if (requestedProfile && projectConfig?.profile === requestedProfile) {
    if (sources.globalConfig) {
      return "project-mono";
    }
    if (sources.legacyAgentsProjectConfig) {
      return "legacy-project-agents";
    }
    return "legacy-project-mono-models";
  }
  if (requestedProfile && sources.globalConfig?.mono.profiles[requestedProfile]) {
    return "global-mono";
  }
  if (requestedProfile && sources.legacyAgentsGlobalConfig?.mono?.profiles?.[requestedProfile]) {
    return "legacy-global-agents";
  }
  if (requestedProfile && sources.legacyProfiles?.[requestedProfile]) {
    return "legacy-global-mono-models";
  }
  return "builtin";
}

async function selectionToModel(cwd: string, selection: string, baseURLOverride?: string): Promise<UnifiedModel> {
  if (selection.includes("/")) {
    const [provider, ...rest] = selection.split("/");
    const canonicalProvider = canonicalizeProviderId(provider);
    const modelId = rest.join("/");
    const catalogProvider = await getCatalogProvider(cwd, canonicalProvider);
    const catalogModel = catalogProvider ? await getCatalogModel(cwd, canonicalProvider, modelId) : undefined;
    if (catalogProvider && catalogModel) {
      if (!catalogProvider.supported || !catalogModel.supported) {
        throw createUnsupportedCatalogModelError(selection, catalogProvider.npm ?? catalogModel.npm);
      }
      const normalized = catalogModelToUnifiedModel(catalogProvider, catalogModel);
      return {
        ...normalized,
        baseURL: baseURLOverride ?? normalized.baseURL
      };
    }
    return createFallbackModel(canonicalProvider, modelId, baseURLOverride);
  }

  for (const catalogModel of await listCatalogModels(cwd)) {
    if (catalogModel.id === selection) {
      const catalogProvider = await getCatalogProvider(cwd, catalogModel.providerId);
      if (catalogProvider) {
        const normalized = catalogModelToUnifiedModel(catalogProvider, catalogModel);
        return {
          ...normalized,
          baseURL: baseURLOverride ?? normalized.baseURL
        };
      }
    }
  }

  const catalog = await getModelsCatalog(cwd);
  for (const provider of Object.values(catalog)) {
    const catalogModel = provider.models[selection];
    if (!catalogModel) {
      continue;
    }
    if (!provider.supported || !catalogModel.supported) {
      throw createUnsupportedCatalogModelError(`${provider.id}/${catalogModel.id}`, provider.npm ?? catalogModel.npm);
    }
    const normalized = catalogModelToUnifiedModel(provider, catalogModel);
    return {
      ...normalized,
      baseURL: baseURLOverride ?? normalized.baseURL
    };
  }

  return createFallbackModel("openai", selection, baseURLOverride ?? resolveBaseURL("openai"));
}

async function normalizeProfileWithCatalog(
  cwd: string,
  profile: MonoProfileConfig,
  profileName: string
): Promise<MonoProfileConfig> {
  const provider = await getCatalogProvider(cwd, profile.provider);
  const model = provider ? await getCatalogModel(cwd, profile.provider, profile.modelId) : undefined;

  if (!provider || !model) {
    return {
      ...profile,
      transport: normalizeModelTransport(profile)
    };
  }

  if (!provider.supported || !model.supported) {
    throw createUnsupportedCatalogModelError(`${profile.provider}/${profile.modelId}`, provider.npm ?? model.npm, profileName);
  }

  const normalized = catalogModelToUnifiedModel(provider, model, {
    runtimeProviderKey: profile.runtimeProviderKey
  });
  const existingBaseURL = profile.baseURL?.trim();
  return {
    ...profile,
    provider: normalized.provider,
    modelId: normalized.modelId,
    family: normalized.family,
    transport: normalizeModelTransport({
      family: normalized.family,
      transport: normalized.transport ?? profile.transport,
      runtimeProviderKey: normalized.runtimeProviderKey ?? profile.runtimeProviderKey
    }),
    runtimeProviderKey: normalized.runtimeProviderKey ?? profile.runtimeProviderKey,
    providerFactory: normalized.providerFactory ?? profile.providerFactory,
    baseURL: shouldPreserveProfileBaseURL(profile, normalized, existingBaseURL) ? existingBaseURL : normalized.baseURL,
    apiKeyEnv: profile.apiKeyEnv ?? normalized.apiKeyEnv,
    supportsTools: normalized.supportsTools,
    supportsReasoning: normalized.supportsReasoning,
    contextWindow: normalized.contextWindow
  };
}

function shouldPreserveProfileBaseURL(
  profile: Pick<MonoProfileConfig, "baseURL" | "runtimeProviderKey">,
  normalized: Pick<UnifiedModel, "baseURL" | "runtimeProviderKey">,
  existingBaseURL: string | undefined
): existingBaseURL is string {
  if (!existingBaseURL) {
    return false;
  }

  if (profile.runtimeProviderKey && profile.runtimeProviderKey === normalized.runtimeProviderKey) {
    return true;
  }

  return !profile.runtimeProviderKey && existingBaseURL !== normalized.baseURL;
}

function ensureSupportedModel(model: UnifiedModel, profileName: string): void {
  if (isSupportedUnifiedModel(model)) {
    return;
  }

  throw new Error(
    `Profile "${profileName}" uses ${model.provider}/${model.modelId} with unsupported transport ${model.transport ?? "unknown"} (${model.family})`
  );
}

function createUnsupportedCatalogModelError(selection: string, npm?: string, profileName?: string): Error {
  const source = profileName ? `Profile "${profileName}"` : `Model "${selection}"`;
  const transport = npm ?? "unknown";
  return new Error(
    `${source} uses catalog transport ${transport}, which mono cannot route with the current adapters`
  );
}

function applyProjectOverride(profile: MonoProfileConfig, projectConfig: MonoProjectConfig | undefined, baseURLOverride?: string): MonoProfileConfig {
  if (!projectConfig) {
    return {
      ...profile,
      baseURL: baseURLOverride ?? profile.baseURL
    };
  }

  return {
    ...profile,
    provider: projectConfig.provider ?? profile.provider,
    modelId: projectConfig.modelId ?? profile.modelId,
    baseURL: baseURLOverride ?? projectConfig.baseURL ?? profile.baseURL,
    apiKeyRef: projectConfig.apiKeyRef ?? profile.apiKeyRef,
    apiKeyEnv: projectConfig.apiKeyEnv ?? profile.apiKeyEnv
  };
}

function resolveMemoryConfig(options: {
  globalConfig: MonoGlobalConfig;
  projectConfig?: MonoProjectConfig;
  store: MonoConfigStore;
}): MonoMemoryConfig {
  const { globalConfig, projectConfig, store } = options;
  const defaults = createDefaultMemoryConfig();
  const globalMemory = globalConfig.mono.memory ?? {};
  const projectMemory = projectConfig?.memory ?? {};
  return {
    ...defaults,
    ...globalMemory,
    ...projectMemory,
    storePath: projectMemory.storePath ?? globalMemory.storePath ?? store.paths.projectMemoryDir,
    retrievalBackend: projectMemory.retrievalBackend ?? globalMemory.retrievalBackend ?? defaults.retrievalBackend,
    fallbackToLocalOnFailure:
      projectMemory.fallbackToLocalOnFailure
      ?? globalMemory.fallbackToLocalOnFailure
      ?? defaults.fallbackToLocalOnFailure,
    openViking: {
      ...defaults.openViking,
      ...globalMemory.openViking,
      ...projectMemory.openViking,
      url: process.env.OPENVIKING_URL ?? projectMemory.openViking?.url ?? globalMemory.openViking?.url ?? defaults.openViking.url,
      agentId:
        process.env.OPENVIKING_AGENT_ID
        ?? projectMemory.openViking?.agentId
        ?? globalMemory.openViking?.agentId
        ?? defaults.openViking.agentId
    },
    seekDb: {
      ...createDefaultSeekDbConfig(),
      ...defaults.seekDb,
      ...globalMemory.seekDb,
      ...projectMemory.seekDb,
      mode:
        (process.env.MONO_SEEKDB_MODE === "python-embedded" || process.env.MONO_SEEKDB_MODE === "mysql"
          ? process.env.MONO_SEEKDB_MODE
          : undefined)
        ?? projectMemory.seekDb?.mode
        ?? globalMemory.seekDb?.mode
        ?? defaults.seekDb.mode,
      mysqlBinary:
        process.env.MONO_SEEKDB_MYSQL_BINARY
        ?? projectMemory.seekDb?.mysqlBinary
        ?? globalMemory.seekDb?.mysqlBinary
        ?? defaults.seekDb.mysqlBinary,
      host:
        process.env.MONO_SEEKDB_HOST
        ?? projectMemory.seekDb?.host
        ?? globalMemory.seekDb?.host
        ?? defaults.seekDb.host,
      port:
        (process.env.MONO_SEEKDB_PORT ? Number(process.env.MONO_SEEKDB_PORT) : undefined)
        ?? projectMemory.seekDb?.port
        ?? globalMemory.seekDb?.port
        ?? defaults.seekDb.port,
      database:
        process.env.MONO_SEEKDB_DATABASE
        ?? projectMemory.seekDb?.database
        ?? globalMemory.seekDb?.database
        ?? defaults.seekDb.database,
      user:
        process.env.MONO_SEEKDB_USER
        ?? projectMemory.seekDb?.user
        ?? globalMemory.seekDb?.user
        ?? defaults.seekDb.user,
      passwordEnv:
        process.env.MONO_SEEKDB_PASSWORD_ENV
        ?? projectMemory.seekDb?.passwordEnv
        ?? globalMemory.seekDb?.passwordEnv
        ?? defaults.seekDb.passwordEnv,
      pythonExecutable:
        process.env.MONO_SEEKDB_PYTHON
        ?? projectMemory.seekDb?.pythonExecutable
        ?? globalMemory.seekDb?.pythonExecutable
        ?? defaults.seekDb.pythonExecutable,
      pythonModule:
        process.env.MONO_SEEKDB_PYTHON_MODULE
        ?? projectMemory.seekDb?.pythonModule
        ?? globalMemory.seekDb?.pythonModule
        ?? defaults.seekDb.pythonModule,
      embeddedPath:
        process.env.MONO_SEEKDB_EMBEDDED_PATH
        ?? projectMemory.seekDb?.embeddedPath
        ?? globalMemory.seekDb?.embeddedPath
        ?? defaults.seekDb.embeddedPath
    }
  };
}

function resolveApiKeyRef(ref: string, secrets: MonoSecretsConfig | undefined): string | undefined {
  if (!ref.startsWith("local:")) {
    return undefined;
  }
  return secrets?.profiles[ref.slice("local:".length)]?.apiKey;
}

async function loadLegacyProfiles(store: MonoConfigStore): Promise<Record<string, MonoProfileConfig> | undefined> {
  const raw = await readJsonFile<{ models?: UnifiedModel[] } | UnifiedModel[]>(store.paths.legacyMonoModelsPath);
  const models = normalizeLegacyModels(raw);
  if (models.length === 0) {
    return undefined;
  }

  const profiles: Record<string, MonoProfileConfig> = {};
  for (const [index, model] of models.entries()) {
    const name = index === 0 ? "default" : `${model.provider}-${sanitizeModelId(model.modelId)}`;
    profiles[name] = modelToProfile(model);
  }
  return profiles;
}

async function loadLegacyProjectConfig(
  store: MonoConfigStore,
  legacyProfiles: Record<string, MonoProfileConfig> | undefined
): Promise<MonoProjectConfig | undefined> {
  const raw = await readJsonFile<{ models?: UnifiedModel[] } | UnifiedModel[]>(store.paths.legacyProjectMonoModelsPath);
  const models = normalizeLegacyModels(raw);
  const first = models[0];
  if (!first) {
    return undefined;
  }

  const profile = Object.entries(legacyProfiles ?? {}).find(([, item]) =>
    item.provider === first.provider && item.modelId === first.modelId
  )?.[0];

  return {
    profile,
    provider: first.provider,
    modelId: first.modelId,
    baseURL: first.baseURL,
    apiKeyEnv: first.apiKeyEnv
  };
}

function unwrapProjectConfig(
  raw: { version?: number; mono?: MonoProjectConfig } | MonoProjectConfig | undefined
): MonoProjectConfig | undefined {
  if (!raw) {
    return undefined;
  }
  if ("mono" in raw && raw.mono !== undefined) {
    return raw.mono;
  }
  return raw as MonoProjectConfig;
}

function normalizeLegacyModels(raw: { models?: UnifiedModel[] } | UnifiedModel[] | undefined): UnifiedModel[] {
  if (!raw) {
    return [];
  }
  return Array.isArray(raw) ? raw : raw.models ?? [];
}

function sanitizeModelId(modelId: string): string {
  return modelId.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "model";
}

function looksLikeInlineApiKey(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  if (/^[A-Z_][A-Z0-9_]*$/.test(value)) {
    return false;
  }
  return value.length >= 16;
}
