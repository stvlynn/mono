import { getBuiltinModels } from "./defaults.js";
import {
  canonicalizeProviderId,
  getCatalogTransportCandidates,
  isSupportedCatalogTransport,
  resolveCatalogTransport
} from "./defaults.js";
import type { CatalogModel, CatalogProvider, RawCatalogModel, RawCatalogProvider } from "./catalog-types.js";

export function normalizeCatalog(raw: Record<string, RawCatalogProvider>): Record<string, CatalogProvider> {
  const providers: Record<string, CatalogProvider> = {};

  for (const [providerId, rawProvider] of Object.entries(raw)) {
    const normalized = normalizeProvider(providerId, rawProvider);
    if (normalized) {
      providers[normalized.id] = normalized;
    }
  }

  return providers;
}

export function createBuiltinCatalog(): Record<string, CatalogProvider> {
  const providers = new Map<string, CatalogProvider>();

  for (const model of getBuiltinModels()) {
    const providerId = canonicalizeProviderId(model.provider);
    const provider = providers.get(providerId) ?? {
      id: providerId,
      canonicalId: providerId,
      name: providerId,
      env: model.apiKeyEnv ? [model.apiKeyEnv] : [],
      api: model.baseURL,
      npm: undefined,
      catalogTransport: model.transport ?? model.family,
      transportCandidates: getCatalogTransportCandidates(providerId, { api: model.baseURL }),
      supported: true,
      models: {}
    };

    provider.models[model.modelId] = {
      id: model.modelId,
      name: model.modelId,
      providerId,
      canonicalProviderId: providerId,
      api: model.baseURL,
      npm: undefined,
      catalogTransport: model.transport ?? model.family,
      transportCandidates: getCatalogTransportCandidates(providerId, { api: model.baseURL }),
      toolCall: model.supportsTools,
      reasoning: model.supportsReasoning,
      temperature: true,
      attachment: false,
      contextWindow: model.contextWindow,
      supported: true
    };

    providers.set(providerId, provider);
  }

  return Object.fromEntries(providers.entries());
}

export function rehydrateCatalog(
  providers: Record<string, CatalogProvider>
): Record<string, CatalogProvider> {
  return Object.fromEntries(
    Object.entries(providers).map(([providerId, provider]) => {
      const api = provider.api;
      const npm = provider.npm;
      const catalogTransport = resolveCatalogTransport(providerId, npm);
      const transportCandidates = getCatalogTransportCandidates(providerId, { api, npm });
      const models = Object.fromEntries(
        Object.entries(provider.models).map(([modelId, model]) => {
          const modelApi = model.api ?? api;
          const modelNpm = model.npm ?? npm;
          const modelTransport = resolveCatalogTransport(providerId, modelNpm);
          const modelCandidates = getCatalogTransportCandidates(providerId, { api: modelApi, npm: modelNpm });
          return [
            modelId,
            {
              ...model,
              catalogTransport: modelTransport,
              transportCandidates: modelCandidates,
              supported: isSupportedCatalogTransport(providerId, modelNpm, modelApi)
            } satisfies CatalogModel
          ];
        })
      );
      const supported = isSupportedCatalogTransport(providerId, npm, api)
        && Object.values(models).some((model) => model.supported);
      return [
        providerId,
        {
          ...provider,
          catalogTransport,
          transportCandidates,
          supported,
          models
        } satisfies CatalogProvider
      ];
    })
  );
}

function normalizeProvider(providerId: string, rawProvider: RawCatalogProvider): CatalogProvider | undefined {
  const id = canonicalizeProviderId(providerId);
  const name = typeof rawProvider.name === "string" && rawProvider.name.trim() ? rawProvider.name.trim() : providerId;
  const env = Array.isArray(rawProvider.env) ? rawProvider.env.filter((value): value is string => typeof value === "string") : [];
  const api = typeof rawProvider.api === "string" && rawProvider.api.trim() ? rawProvider.api.trim() : undefined;
  const npm = typeof rawProvider.npm === "string" && rawProvider.npm.trim() ? rawProvider.npm.trim() : undefined;
  const doc = typeof rawProvider.doc === "string" && rawProvider.doc.trim() ? rawProvider.doc.trim() : undefined;
  const catalogTransport = resolveCatalogTransport(id, npm);
  const transportCandidates = getCatalogTransportCandidates(id, { api, npm });
  const models: Record<string, CatalogModel> = {};

  if (rawProvider.models && typeof rawProvider.models === "object") {
    for (const [modelId, rawModel] of Object.entries(rawProvider.models as Record<string, RawCatalogModel>)) {
      const model = normalizeModel(id, modelId, rawModel, { api, npm });
      if (model) {
        models[model.id] = model;
      }
    }
  }

  const supported = isSupportedCatalogTransport(id, npm, api)
    && Object.values(models).some((model) => model.supported);

  return {
    id,
    canonicalId: id,
    name,
    env,
    api,
    npm,
    doc,
    catalogTransport,
    transportCandidates,
    supported,
    models
  };
}

function normalizeModel(
  providerId: string,
  modelId: string,
  rawModel: RawCatalogModel,
  provider: { api?: string; npm?: string }
): CatalogModel | undefined {
  const id = typeof rawModel.id === "string" && rawModel.id.trim() ? rawModel.id.trim() : modelId;
  const providerOverride = normalizeModelProviderOverride(rawModel.provider);
  const name = typeof rawModel.name === "string" && rawModel.name.trim() ? rawModel.name.trim() : id;
  const api = providerOverride.api ?? provider.api;
  const npm = providerOverride.npm ?? provider.npm;
  const contextWindow = normalizeContextWindow(rawModel.limit);
  const catalogTransport = resolveCatalogTransport(providerId, npm);
  const transportCandidates = getCatalogTransportCandidates(providerId, { api, npm });
  const supported = isSupportedCatalogTransport(providerId, npm, api);

  return {
    id,
    name,
    providerId,
    canonicalProviderId: providerId,
    api,
    npm,
    catalogTransport,
    transportCandidates,
    toolCall: rawModel.tool_call !== false,
    reasoning: rawModel.reasoning === true,
    temperature: rawModel.temperature !== false,
    attachment: rawModel.attachment === true,
    contextWindow,
    supported
  };
}

function normalizeModelProviderOverride(input: unknown): { api?: string; npm?: string } {
  if (!input || typeof input !== "object") {
    return {};
  }
  const provider = input as Record<string, unknown>;
  return {
    api: typeof provider.api === "string" && provider.api.trim() ? provider.api.trim() : undefined,
    npm: typeof provider.npm === "string" && provider.npm.trim() ? provider.npm.trim() : undefined
  };
}

function normalizeContextWindow(limit: unknown): number | undefined {
  if (!limit || typeof limit !== "object") {
    return undefined;
  }
  const context = (limit as Record<string, unknown>).context;
  return typeof context === "number" && Number.isFinite(context) ? context : undefined;
}
