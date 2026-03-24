import type { GlobalConfig, ProfileConfig, UnifiedModel } from "@/types"

export function cloneConfig<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function listToTextarea(values: string[]): string {
  return values.join("\n")
}

export function textareaToList(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
}

export function parseJsonInput<T>(value: string): { value?: T; error?: string } {
  const normalized = value.trim()
  if (!normalized) {
    return { error: "Value is required." }
  }

  try {
    return { value: JSON.parse(normalized) as T }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Invalid JSON.",
    }
  }
}

export function serializeConfig(value: GlobalConfig): string {
  return JSON.stringify(value, null, 2)
}

export function normalizeConfigAliases(config: GlobalConfig): GlobalConfig {
  const next = cloneConfig(config)
  const settings = next.mono.settings

  settings.approvalMode = settings.safety.approvalMode
  settings.approvalPolicy = settings.safety.approvalPolicy
  settings.sandboxMode = settings.safety.sandboxMode
  settings.sensitiveActionMode = settings.safety.sensitiveActionMode
  settings.maxAutonomousTasksPerHour = settings.autonomy.maxAutonomousTasksPerHour
  settings.theme = settings.appearance.theme

  return next
}

export function buildProfileFromModel(model: UnifiedModel): ProfileConfig {
  return {
    provider: model.provider,
    modelId: model.modelId,
    baseURL: model.baseURL,
    family: model.family,
    transport: model.transport ?? model.family,
    runtimeProviderKey: model.runtimeProviderKey,
    providerFactory: model.providerFactory,
    apiKeyEnv: model.apiKeyEnv,
    supportsTools: model.supportsTools,
    supportsReasoning: model.supportsReasoning,
    supportsAttachments: model.supportsAttachments,
    contextWindow: model.contextWindow,
  }
}

export function createFallbackProfile(provider = "openai"): ProfileConfig {
  return {
    provider,
    modelId: "",
    baseURL: "",
    family: provider === "anthropic" ? "anthropic" : provider === "google" || provider === "gemini" ? "gemini" : "openai-compatible",
    transport: provider === "anthropic" ? "anthropic" : provider === "google" || provider === "gemini" ? "gemini" : "openai-compatible",
    providerFactory: provider === "anthropic" ? "anthropic" : provider === "google" || provider === "gemini" ? "google" : provider === "openrouter" ? "openrouter" : provider === "openai" ? "openai" : "custom",
    supportsTools: true,
    supportsReasoning: true,
    supportsAttachments: true,
  }
}

export function getProviderOptions(models: UnifiedModel[], profiles: ProfileConfig[]): string[] {
  const values = new Set<string>(profiles.map((profile) => profile.provider))
  for (const model of models) {
    values.add(model.provider)
  }
  return [...values].sort((left, right) => left.localeCompare(right))
}

export function getModelsForProvider(models: UnifiedModel[], provider: string): UnifiedModel[] {
  return models
    .filter((model) => model.provider === provider)
    .sort((left, right) => left.modelId.localeCompare(right.modelId))
}
