import { getBuiltinModels, getMonoConfigSummary, listProfiles, resolveMonoConfig } from "@mono/config";
import type { MonoConfigSummary, ResolvedMonoConfig, UnifiedModel } from "@mono/shared";

export interface RegistryOptions {
  cwd?: string;
}

interface LoadedProfile {
  name: string;
  model: UnifiedModel;
}

export class ModelRegistry {
  private readonly cwd: string;
  private models = new Map<string, UnifiedModel>();
  private profiles = new Map<string, UnifiedModel>();

  constructor(options: RegistryOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    for (const model of getBuiltinModels()) {
      this.models.set(this.keyFor(model.provider, model.modelId), model);
    }
  }

  private keyFor(provider: string, modelId: string): string {
    return `${provider}/${modelId}`;
  }

  async load(): Promise<void> {
    this.profiles.clear();
    for (const profile of await listProfiles(this.cwd)) {
      const model = {
        provider: profile.profile.provider,
        modelId: profile.profile.modelId,
        family: profile.profile.family,
        transport: profile.profile.transport,
        baseURL: profile.profile.baseURL,
        apiKeyEnv: profile.profile.apiKeyEnv,
        providerFactory: profile.profile.providerFactory,
        supportsTools: profile.profile.supportsTools,
        supportsReasoning: profile.profile.supportsReasoning,
        contextWindow: profile.profile.contextWindow
      } satisfies UnifiedModel;
      this.profiles.set(profile.name, model);
      this.models.set(this.keyFor(model.provider, model.modelId), model);
    }
  }

  async resolveConfig(selection?: string, profile?: string, baseURL?: string): Promise<ResolvedMonoConfig> {
    return resolveMonoConfig({
      cwd: this.cwd,
      modelSelection: selection,
      profileSelection: profile,
      baseURLOverride: baseURL
    });
  }

  async getConfigSummary(): Promise<MonoConfigSummary> {
    return getMonoConfigSummary(this.cwd);
  }

  resolve(selection?: string): UnifiedModel {
    if (!selection) {
      return this.profiles.get("default") ?? this.models.get("openai/gpt-4.1-mini") ?? getBuiltinModels()[0];
    }

    const profile = this.profiles.get(selection);
    if (profile) {
      return profile;
    }

    if (selection.includes("/")) {
      const [provider, ...rest] = selection.split("/");
      const modelId = rest.join("/");
      const exact = this.models.get(this.keyFor(provider, modelId));
      if (exact) {
        return exact;
      }

      return {
        provider,
        modelId,
        family: provider === "anthropic" ? "anthropic" : provider === "gemini" ? "gemini" : "openai-compatible",
        transport: "xsai-openai-compatible",
        baseURL: baseURLFor(provider),
        apiKeyEnv: apiKeyEnvFor(provider),
        providerFactory: providerFactoryFor(provider),
        supportsTools: true,
        supportsReasoning: true
      };
    }

    for (const model of this.models.values()) {
      if (model.modelId === selection) {
        return model;
      }
    }

    return {
      provider: "openai",
      modelId: selection,
      family: "openai-compatible",
      transport: "xsai-openai-compatible",
      baseURL: baseURLFor("openai"),
      apiKeyEnv: apiKeyEnvFor("openai"),
      providerFactory: "openai",
      supportsTools: true,
      supportsReasoning: true
    };
  }

  list(): UnifiedModel[] {
    return [...this.models.values()];
  }

  listProfileNames(): string[] {
    return [...this.profiles.keys()].sort();
  }

  listProfiles(): LoadedProfile[] {
    return [...this.profiles.entries()].map(([name, model]) => ({ name, model }));
  }
}

function baseURLFor(provider: string): string {
  if (process.env.MONO_BASE_URL) {
    return process.env.MONO_BASE_URL;
  }

  switch (provider) {
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

function apiKeyEnvFor(provider: string): string | undefined {
  switch (provider) {
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

function providerFactoryFor(provider: string): UnifiedModel["providerFactory"] {
  switch (provider) {
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
