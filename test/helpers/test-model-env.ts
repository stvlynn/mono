import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "vitest";
import type { ModelTransport, MonoProfileConfig, UnifiedModel } from "../../packages/shared/src/index.js";

interface LoadedTestModelEnv {
  provider: string;
  modelId: string;
  baseURL: string;
  apiKey?: string;
  apiKeyEnv: string;
  family: UnifiedModel["family"];
  transport: ModelTransport;
  providerFactory: NonNullable<UnifiedModel["providerFactory"]>;
}

let cachedEnvLoaded = false;

export function hasRealTestModelConfig(): boolean {
  ensureDotEnvLoaded();
  return Boolean(
    process.env.MONO_TEST_PROVIDER?.trim() || process.env.MONO_BOOTSTRAP_PROVIDER?.trim()
  ) && Boolean(
    process.env.MONO_TEST_MODEL?.trim() || process.env.MONO_BOOTSTRAP_MODEL?.trim()
  ) && Boolean(
    process.env.MONO_TEST_BASE_URL?.trim() || process.env.MONO_BOOTSTRAP_BASE_URL?.trim()
  );
}

export function getRealTestModelSkipReason(): string | undefined {
  return hasRealTestModelConfig() ? undefined : "Real test model is not configured in .env";
}

export const describeIfRealTestModel = hasRealTestModelConfig() ? describe : describe.skip;
export const itIfRealTestModel = hasRealTestModelConfig() ? it : it.skip;

export function createTestUnifiedModel(overrides: Partial<UnifiedModel> = {}): UnifiedModel {
  const loaded = loadTestModelEnv();
  return {
    provider: loaded.provider,
    modelId: loaded.modelId,
    family: loaded.family,
    transport: loaded.transport,
    runtimeProviderKey: `${loaded.provider}:${loaded.transport}`,
    baseURL: loaded.baseURL,
    ...(loaded.apiKey ? { apiKey: loaded.apiKey } : {}),
    apiKeyEnv: loaded.apiKeyEnv,
    providerFactory: loaded.providerFactory,
    supportsTools: true,
    supportsReasoning: true,
    supportsAttachments: true,
    ...overrides,
  };
}

export function createTestProfileConfig(overrides: Partial<MonoProfileConfig> = {}): MonoProfileConfig {
  const loaded = loadTestModelEnv();
  return {
    provider: loaded.provider,
    modelId: loaded.modelId,
    baseURL: loaded.baseURL,
    family: loaded.family,
    transport: loaded.transport,
    providerFactory: loaded.providerFactory,
    apiKeyEnv: loaded.apiKeyEnv,
    supportsTools: true,
    supportsReasoning: true,
    supportsAttachments: true,
    ...overrides,
  };
}

export function getTestModelSelectionString(): string {
  const loaded = loadTestModelEnv();
  return `${loaded.provider}/${loaded.modelId}`;
}

function loadTestModelEnv(): LoadedTestModelEnv {
  ensureDotEnvLoaded();

  const provider = process.env.MONO_TEST_PROVIDER?.trim() || process.env.MONO_BOOTSTRAP_PROVIDER?.trim() || "__missing_provider__";
  const modelId = process.env.MONO_TEST_MODEL?.trim() || process.env.MONO_BOOTSTRAP_MODEL?.trim() || "__missing_model__";
  const baseURL = process.env.MONO_TEST_BASE_URL?.trim() || process.env.MONO_BOOTSTRAP_BASE_URL?.trim() || "https://invalid.test.local";
  const apiKey = process.env.MONO_TEST_API_KEY?.trim() || process.env.MONO_API_KEY?.trim() || undefined;
  const apiKeyEnv = process.env.MONO_TEST_API_KEY_ENV?.trim() || resolveDefaultApiKeyEnv(provider);
  const transport = resolveTransport(provider, process.env.MONO_TEST_TRANSPORT?.trim());
  const family = resolveFamily(provider, process.env.MONO_TEST_FAMILY?.trim(), transport);
  const providerFactory = resolveProviderFactory(provider);

  return {
    provider,
    modelId,
    baseURL,
    apiKey,
    apiKeyEnv,
    family,
    transport,
    providerFactory,
  };
}

function ensureDotEnvLoaded(): void {
  if (cachedEnvLoaded) {
    return;
  }
  cachedEnvLoaded = true;
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) {
    return;
  }
  const lines = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }
    process.env[key] = stripQuotes(rawValue);
  }
}

function stripQuotes(value: string): string {
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function resolveTransport(provider: string, explicit?: string): ModelTransport {
  if (explicit === "openai-compatible" || explicit === "openai-responses" || explicit === "anthropic" || explicit === "gemini") {
    return explicit;
  }
  if (provider === "anthropic") {
    return "anthropic";
  }
  if (provider === "google" || provider === "gemini") {
    return "gemini";
  }
  return "openai-compatible";
}

function resolveFamily(
  provider: string,
  explicit: string | undefined,
  transport: ModelTransport
): UnifiedModel["family"] {
  if (explicit === "openai-compatible" || explicit === "anthropic" || explicit === "gemini") {
    return explicit;
  }
  if (provider === "anthropic" || transport === "anthropic") {
    return "anthropic";
  }
  if (provider === "google" || provider === "gemini" || transport === "gemini") {
    return "gemini";
  }
  return "openai-compatible";
}

function resolveProviderFactory(provider: string): NonNullable<UnifiedModel["providerFactory"]> {
  if (provider === "openai") {
    return "openai";
  }
  if (provider === "anthropic") {
    return "anthropic";
  }
  if (provider === "google" || provider === "gemini") {
    return "google";
  }
  if (provider === "openrouter") {
    return "openrouter";
  }
  return "custom";
}

function resolveDefaultApiKeyEnv(provider: string): string {
  switch (provider) {
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "google":
    case "gemini":
      return "GEMINI_API_KEY";
    case "openrouter":
      return "OPENROUTER_API_KEY";
    case "xai":
      return "XAI_API_KEY";
    case "moonshotai":
      return "MOONSHOT_API_KEY";
    case "minimax":
      return "MINIMAX_API_KEY";
    case "openai":
    default:
      return "OPENAI_API_KEY";
  }
}
