import type { MonoGlobalConfig, MonoMemoryConfig, MonoProfileConfig, UnifiedModel } from "@mono/shared";

const BUILTIN_MODELS: UnifiedModel[] = [
  {
    provider: "openai",
    modelId: "gpt-4.1-mini",
    family: "openai-compatible",
    transport: "xsai-openai-compatible",
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
    transport: "xsai-openai-compatible",
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
    transport: "xsai-openai-compatible",
    baseURL: "https://api.x.ai/v1",
    apiKeyEnv: "XAI_API_KEY",
    providerFactory: "custom",
    supportsTools: true,
    supportsReasoning: true
  },
  {
    provider: "anthropic",
    modelId: "claude-sonnet-4-5",
    family: "anthropic",
    transport: "xsai-openai-compatible",
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
    keywordSearchLimit: 6
  };
}

export function modelToProfile(model: UnifiedModel): MonoProfileConfig {
  return {
    provider: model.provider,
    modelId: model.modelId,
    baseURL: model.baseURL,
    family: model.family,
    transport: model.transport ?? "xsai-openai-compatible",
    providerFactory: model.providerFactory,
    apiKeyRef: model.apiKey ? undefined : undefined,
    apiKeyEnv: model.apiKeyEnv,
    supportsTools: model.supportsTools,
    supportsReasoning: model.supportsReasoning,
    contextWindow: model.contextWindow
  };
}

export function createFallbackModel(provider: string, modelId: string, baseURLOverride?: string): UnifiedModel {
  return {
    provider,
    modelId,
    family: provider === "anthropic" ? "anthropic" : provider === "gemini" ? "gemini" : "openai-compatible",
    transport: "xsai-openai-compatible",
    baseURL: baseURLOverride ?? resolveBaseURL(provider),
    apiKeyEnv: resolveApiKeyEnv(provider),
    providerFactory: resolveProviderFactory(provider),
    supportsTools: true,
    supportsReasoning: true
  };
}

export function profileToModel(profile: MonoProfileConfig): UnifiedModel {
  return {
    provider: profile.provider,
    modelId: profile.modelId,
    family: profile.family,
    transport: profile.transport,
    baseURL: profile.baseURL,
    apiKeyEnv: profile.apiKeyEnv,
    providerFactory: profile.providerFactory,
    supportsTools: profile.supportsTools,
    supportsReasoning: profile.supportsReasoning,
    contextWindow: profile.contextWindow
  };
}

export function resolveBaseURL(provider: string): string {
  if (process.env.MONO_BASE_URL) {
    return process.env.MONO_BASE_URL;
  }

  switch (provider) {
    case "moonshot":
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
  switch (provider) {
    case "moonshot":
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
  switch (provider) {
    case "moonshot":
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
