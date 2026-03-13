import {
  canonicalizeProviderId,
  catalogModelToUnifiedModel,
  createFallbackModel,
  getBuiltinModels,
  getMonoConfigSummary,
  listCatalogProviders,
  listProfiles,
  resolveMonoConfig
} from "@mono/config";
import type { MonoConfigSummary, ResolvedMonoConfig, UnifiedModel } from "@mono/shared";

export interface RegistryOptions {
  cwd?: string;
}

export interface LoadedProfile {
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
    this.models.clear();
    for (const builtin of getBuiltinModels()) {
      this.models.set(this.keyFor(builtin.provider, builtin.modelId), builtin);
    }
    this.profiles.clear();
    for (const provider of await listCatalogProviders(this.cwd)) {
      for (const catalogModel of Object.values(provider.models).filter((model) => model.supported)) {
        const model = catalogModelToUnifiedModel(provider, catalogModel);
        this.models.set(this.keyFor(model.provider, model.modelId), model);
      }
    }
    for (const profile of await listProfiles(this.cwd)) {
      const model = {
        provider: profile.profile.provider,
        modelId: profile.profile.modelId,
        family: profile.profile.family,
        transport: profile.profile.transport,
        runtimeProviderKey: profile.profile.runtimeProviderKey,
        baseURL: profile.profile.baseURL,
        apiKeyEnv: profile.profile.apiKeyEnv,
        providerFactory: profile.profile.providerFactory,
        supportsTools: profile.profile.supportsTools,
        supportsReasoning: profile.profile.supportsReasoning,
        supportsAttachments: profile.profile.supportsAttachments,
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
      const canonicalProvider = canonicalizeProviderId(provider);
      const modelId = rest.join("/");
      const exact = this.models.get(this.keyFor(provider, modelId));
      if (exact) {
        return exact;
      }
      const canonical = this.models.get(this.keyFor(canonicalProvider, modelId));
      if (canonical) {
        return canonical;
      }

      return createFallbackModel(canonicalProvider, modelId);
    }

    for (const model of this.models.values()) {
      if (model.modelId === selection) {
        return model;
      }
    }

    return createFallbackModel("openai", selection);
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
