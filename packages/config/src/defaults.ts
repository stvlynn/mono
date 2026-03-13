import type {
  MonoGlobalConfig,
  MonoMemoryConfig,
  MonoOpenVikingConfig,
  MonoProfileConfig,
  MonoSeekDbConfig,
  UnifiedModel
} from "@mono/shared";
import type { CatalogTransportCandidate, CatalogTransportKind } from "./catalog-types.js";

const PROVIDER_ALIASES: Record<string, string> = {
  gemini: "google",
  moonshot: "moonshotai"
};

const BUILTIN_MODELS: UnifiedModel[] = [
  {
    provider: "openai",
    modelId: "gpt-4.1-mini",
    family: "openai-compatible",
    transport: "openai-compatible",
    baseURL: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
    providerFactory: "openai",
    supportsTools: true,
    supportsReasoning: true
  },
  {
    provider: "openrouter",
    modelId: "openai/gpt-4.1-mini",
    family: "openai-compatible",
    transport: "openai-compatible",
    baseURL: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
    providerFactory: "openrouter",
    supportsTools: true,
    supportsReasoning: true
  },
  {
    provider: "xai",
    modelId: "grok-2-latest",
    family: "openai-compatible",
    transport: "openai-compatible",
    baseURL: "https://api.x.ai/v1",
    apiKeyEnv: "XAI_API_KEY",
    providerFactory: "custom",
    supportsTools: true,
    supportsReasoning: true
  },
  {
    provider: "moonshotai",
    modelId: "kimi-k2-turbo-preview",
    family: "openai-compatible",
    transport: "openai-compatible",
    baseURL: "https://api.moonshot.cn/v1",
    apiKeyEnv: "MOONSHOT_API_KEY",
    providerFactory: "custom",
    supportsTools: true,
    supportsReasoning: true
  },
  {
    provider: "anthropic",
    modelId: "claude-sonnet-4-5",
    family: "anthropic",
    transport: "anthropic",
    baseURL: "https://api.anthropic.com/v1",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    providerFactory: "anthropic",
    supportsTools: true,
    supportsReasoning: true
  }
];

export function getBuiltinModels(): UnifiedModel[] {
  return BUILTIN_MODELS.map((model) => ({ ...model }));
}

export function canonicalizeProviderId(provider: string): string {
  return PROVIDER_ALIASES[provider] ?? provider;
}

const OPENAI_COMPATIBLE_NPM_PACKAGES = new Set([
  "@ai-sdk/openai-compatible",
  "@ai-sdk/openai",
  "@openrouter/ai-sdk-provider",
  "@ai-sdk/xai",
  "@ai-sdk/groq",
  "@ai-sdk/mistral",
  "@ai-sdk/togetherai",
  "@ai-sdk/deepinfra",
  "@ai-sdk/perplexity",
  "@ai-sdk/cerebras"
]);

const ANTHROPIC_NPM_PACKAGES = new Set([
  "@ai-sdk/anthropic"
]);

const GOOGLE_NPM_PACKAGES = new Set([
  "@ai-sdk/google"
]);

export function getBuiltinProfiles(): Record<string, MonoProfileConfig> {
  return {
    default: modelToProfile(BUILTIN_MODELS[0])
  };
}

export function createDefaultGlobalConfig(): MonoGlobalConfig {
  return {
    version: 1,
    mono: {
      defaultProfile: "default",
      profiles: getBuiltinProfiles(),
      settings: {
        approvalMode: "default",
        theme: "system"
      },
      memory: createDefaultMemoryConfig()
    },
    projects: {}
  };
}

export function resolveCatalogTransport(
  provider: string,
  npm?: string
): "openai-compatible" | "anthropic" | "gemini" | undefined {
  const canonicalProvider = canonicalizeProviderId(provider);

  if (npm) {
    if (ANTHROPIC_NPM_PACKAGES.has(npm)) {
      return "anthropic";
    }
    if (OPENAI_COMPATIBLE_NPM_PACKAGES.has(npm)) {
      return "openai-compatible";
    }
    if (GOOGLE_NPM_PACKAGES.has(npm)) {
      return "gemini";
    }
    return undefined;
  }

  switch (canonicalProvider) {
    case "anthropic":
      return "anthropic";
    case "google":
      return "gemini";
    case "openai":
    case "openrouter":
    case "moonshotai":
    case "xai":
      return "openai-compatible";
    default:
      return undefined;
  }
}

const RUNTIME_TRANSPORT_OVERRIDES: Record<string, CatalogTransportCandidate[]> = {};

function buildCatalogTransportCandidate(provider: string, npm?: string, api?: string): CatalogTransportCandidate[] {
  const canonicalProvider = canonicalizeProviderId(provider);
  const kind = resolveCatalogTransport(canonicalProvider, npm);
  if (!kind || !api) {
    return [];
  }

  return [
    {
      kind,
      source: "catalog",
      api,
      npm,
      providerFactory: resolveCatalogProviderFactory(
        canonicalProvider,
        kind === "anthropic" ? "anthropic" : kind === "gemini" ? "gemini" : "openai-compatible"
      ),
      runtimeProviderKey: `${canonicalProvider}:${kind}`,
      supportedByMono: isTransportCandidateSupported(canonicalProvider, kind, "catalog")
    }
  ];
}

function dedupeTransportCandidates(candidates: CatalogTransportCandidate[]): CatalogTransportCandidate[] {
  const deduped = new Map<string, CatalogTransportCandidate>();
  for (const candidate of candidates) {
    const key = [
      candidate.kind,
      candidate.source,
      candidate.api ?? "",
      candidate.npm ?? "",
      candidate.runtimeProviderKey ?? ""
    ].join(":");
    deduped.set(key, candidate);
  }
  return [...deduped.values()];
}

export function getCatalogTransportCandidates(
  provider: string,
  options: { npm?: string; api?: string }
): CatalogTransportCandidate[] {
  const canonicalProvider = canonicalizeProviderId(provider);
  return dedupeTransportCandidates([
    ...buildCatalogTransportCandidate(canonicalProvider, options.npm, options.api),
    ...(RUNTIME_TRANSPORT_OVERRIDES[canonicalProvider] ?? [])
  ]);
}

export function isTransportCandidateSupported(
  provider: string,
  kind: CatalogTransportKind,
  source: CatalogTransportCandidate["source"] = "catalog"
): boolean {
  if (source === "runtime-override") {
    return true;
  }
  return kind === "openai-compatible" || kind === "anthropic" || kind === "gemini";
}

export function selectCatalogTransportCandidate(
  provider: string,
  candidates: CatalogTransportCandidate[],
  options: {
    runtimeProviderKey?: string;
    preferredKind?: UnifiedModel["family"];
  } = {}
): CatalogTransportCandidate | undefined {
  const supportedCandidates = candidates.filter((candidate) => candidate.supportedByMono);
  if (supportedCandidates.length === 0) {
    return undefined;
  }

  if (options.runtimeProviderKey) {
    const exact = supportedCandidates.find((candidate) => candidate.runtimeProviderKey === options.runtimeProviderKey);
    if (exact) {
      return exact;
    }
  }

  if (options.preferredKind) {
    const byKind = supportedCandidates.find((candidate) => candidate.kind === options.preferredKind);
    if (byKind) {
      return byKind;
    }
  }

  const preferred = supportedCandidates.find((candidate) => candidate.preferred);
  if (preferred) {
    return preferred;
  }

  return supportedCandidates[0];
}

export function resolveCatalogModelFamily(
  provider: string,
  npm?: string
): UnifiedModel["family"] | undefined {
  const transport = resolveCatalogTransport(provider, npm);
  if (transport === "anthropic") {
    return "anthropic";
  }
  if (transport === "gemini") {
    return "gemini";
  }
  if (transport === "openai-compatible") {
    return "openai-compatible";
  }
  return undefined;
}

function resolveTransportFromRuntimeProviderKey(runtimeProviderKey?: string): NonNullable<UnifiedModel["transport"]> | undefined {
  const kind = runtimeProviderKey?.split(":").at(-1);
  if (kind === "openai-compatible" || kind === "anthropic" || kind === "gemini") {
    return kind;
  }
  return undefined;
}

export function normalizeModelTransport(
  model: {
    family: UnifiedModel["family"];
    transport?: string;
    runtimeProviderKey?: string;
  }
): NonNullable<UnifiedModel["transport"]> {
  if (model.transport === "openai-compatible" || model.transport === "anthropic" || model.transport === "gemini") {
    return model.transport;
  }
  return resolveTransportFromRuntimeProviderKey(model.runtimeProviderKey) ?? model.family;
}

export function resolveCatalogProviderFactory(
  provider: string,
  family?: UnifiedModel["family"]
): UnifiedModel["providerFactory"] {
  const canonicalProvider = canonicalizeProviderId(provider);

  if (family === "anthropic") {
    return canonicalProvider === "anthropic" ? "anthropic" : "custom";
  }
  if (family === "gemini") {
    return "google";
  }

  switch (canonicalProvider) {
    case "openai":
      return "openai";
    case "openrouter":
      return "openrouter";
    case "google":
      return "google";
    default:
      return "custom";
  }
}

export function isSupportedCatalogTransport(provider: string, npm?: string, api?: string): boolean {
  return getCatalogTransportCandidates(provider, { npm, api }).some((candidate) => candidate.supportedByMono);
}

export function isSupportedUnifiedModel(model: Pick<UnifiedModel, "family" | "transport" | "runtimeProviderKey" | "provider">): boolean {
  const transport = normalizeModelTransport(model);
  return (transport === "openai-compatible" || transport === "anthropic" || transport === "gemini")
    && (model.family === "openai-compatible" || model.family === "anthropic" || model.family === "gemini");
}

export function createDefaultMemoryConfig(): MonoMemoryConfig {
  return {
    enabled: true,
    autoInject: true,
    storePath: ".mono/memories",
    latestRoots: 4,
    compactedLevelNum: 1,
    rawPairLevelNum: 3,
    compactedCapNum: 8,
    rawPairCapNum: 8,
    keywordSearchLimit: 6,
    retrievalBackend: "local",
    fallbackToLocalOnFailure: true,
    openViking: createDefaultOpenVikingConfig(),
    seekDb: createDefaultSeekDbConfig()
  };
}

export function createDefaultOpenVikingConfig(): MonoOpenVikingConfig {
  return {
    enabled: false,
    url: process.env.OPENVIKING_URL,
    apiKeyEnv: "OPENVIKING_API_KEY",
    agentId: process.env.OPENVIKING_AGENT_ID ?? "mono",
    timeoutMs: 30_000,
    targetUri: "viking://agent/memories/",
    useSessionSearch: true,
    shadowExport: false
  };
}

export function createDefaultSeekDbConfig(): MonoSeekDbConfig {
  return {
    enabled: false,
    mode: process.env.MONO_SEEKDB_MODE === "python-embedded" ? "python-embedded" : "mysql",
    timeoutMs: 30_000,
    mysqlBinary: process.env.MONO_SEEKDB_MYSQL_BINARY ?? "mysql",
    host: process.env.MONO_SEEKDB_HOST,
    port: process.env.MONO_SEEKDB_PORT ? Number(process.env.MONO_SEEKDB_PORT) : undefined,
    database: process.env.MONO_SEEKDB_DATABASE,
    user: process.env.MONO_SEEKDB_USER,
    passwordEnv: process.env.MONO_SEEKDB_PASSWORD_ENV ?? "MONO_SEEKDB_PASSWORD",
    pythonExecutable: process.env.MONO_SEEKDB_PYTHON ?? "python3",
    pythonModule: process.env.MONO_SEEKDB_PYTHON_MODULE ?? "seekdb",
    embeddedPath: process.env.MONO_SEEKDB_EMBEDDED_PATH,
    mirrorSessionsOnly: true
  };
}

export function modelToProfile(model: UnifiedModel): MonoProfileConfig {
  return {
    provider: model.provider,
    modelId: model.modelId,
    baseURL: model.baseURL,
    family: model.family,
    transport: normalizeModelTransport(model),
    runtimeProviderKey: model.runtimeProviderKey,
    providerFactory: model.providerFactory,
    apiKeyRef: model.apiKey ? undefined : undefined,
    apiKeyEnv: model.apiKeyEnv,
    supportsTools: model.supportsTools,
    supportsReasoning: model.supportsReasoning,
    contextWindow: model.contextWindow
  };
}

export function createFallbackModel(provider: string, modelId: string, baseURLOverride?: string): UnifiedModel {
  const canonicalProvider = canonicalizeProviderId(provider);
  const runtimeCandidate = selectCatalogTransportCandidate(canonicalProvider, getCatalogTransportCandidates(canonicalProvider, {
    api: baseURLOverride ?? resolveBaseURL(canonicalProvider)
  }));
  const family =
    runtimeCandidate?.kind === "anthropic"
      ? "anthropic"
      : runtimeCandidate?.kind === "gemini"
        ? "gemini"
        : resolveModelFamily(canonicalProvider);
  return {
    provider: canonicalProvider,
    modelId,
    family,
    transport: runtimeCandidate?.kind ?? family,
    runtimeProviderKey: runtimeCandidate?.runtimeProviderKey,
    baseURL: baseURLOverride ?? runtimeCandidate?.api ?? resolveBaseURL(canonicalProvider),
    apiKeyEnv: resolveApiKeyEnv(canonicalProvider),
    providerFactory: runtimeCandidate?.providerFactory ?? resolveProviderFactory(canonicalProvider),
    supportsTools: true,
    supportsReasoning: true
  };
}

export function profileToModel(profile: MonoProfileConfig): UnifiedModel {
  return {
    provider: profile.provider,
    modelId: profile.modelId,
    family: profile.family,
    transport: normalizeModelTransport(profile),
    runtimeProviderKey: profile.runtimeProviderKey,
    baseURL: profile.baseURL,
    apiKeyEnv: profile.apiKeyEnv,
    providerFactory: profile.providerFactory,
    supportsTools: profile.supportsTools,
    supportsReasoning: profile.supportsReasoning,
    contextWindow: profile.contextWindow
  };
}

export function resolveBaseURL(provider: string): string {
  const canonicalProvider = canonicalizeProviderId(provider);
  if (process.env.MONO_BASE_URL) {
    return process.env.MONO_BASE_URL;
  }

  switch (canonicalProvider) {
    case "moonshotai":
      return "https://api.moonshot.cn/v1";
    case "anthropic":
      return "https://api.anthropic.com/v1";
    case "openrouter":
      return "https://openrouter.ai/api/v1";
    case "google":
    case "gemini":
      return "https://generativelanguage.googleapis.com/v1beta/openai";
    case "xai":
      return "https://api.x.ai/v1";
    default:
      return "https://api.openai.com/v1";
  }
}

export function resolveApiKeyEnv(provider: string): string | undefined {
  switch (canonicalizeProviderId(provider)) {
    case "moonshotai":
      return "MOONSHOT_API_KEY";
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "openrouter":
      return "OPENROUTER_API_KEY";
    case "google":
    case "gemini":
      return "GEMINI_API_KEY";
    case "xai":
      return "XAI_API_KEY";
    default:
      return "OPENAI_API_KEY";
  }
}

export function resolveProviderFactory(provider: string): UnifiedModel["providerFactory"] {
  switch (canonicalizeProviderId(provider)) {
    case "moonshotai":
      return "custom";
    case "anthropic":
      return "anthropic";
    case "openrouter":
      return "openrouter";
    case "openai":
      return "openai";
    case "google":
    case "gemini":
      return "google";
    default:
      return "custom";
  }
}

export function resolveModelFamily(provider: string): UnifiedModel["family"] {
  switch (canonicalizeProviderId(provider)) {
    case "anthropic":
      return "anthropic";
    case "google":
      return "gemini";
    default:
      return "openai-compatible";
  }
}
