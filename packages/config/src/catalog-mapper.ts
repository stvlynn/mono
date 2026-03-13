import type { UnifiedModel } from "@mono/shared";
import {
  isSupportedUnifiedModel,
  resolveApiKeyEnv,
  resolveBaseURL,
  selectCatalogTransportCandidate
} from "./defaults.js";
import type { CatalogModel, CatalogProvider } from "./catalog-types.js";

export function catalogModelToUnifiedModel(
  provider: CatalogProvider,
  model: CatalogModel,
  options: {
    runtimeProviderKey?: string;
    preferredFamily?: UnifiedModel["family"];
  } = {}
): UnifiedModel {
  const selectedCandidate = selectCatalogTransportCandidate(
    model.canonicalProviderId,
    model.transportCandidates ?? provider.transportCandidates ?? [],
    {
      runtimeProviderKey: options.runtimeProviderKey,
      preferredKind: options.preferredFamily
    }
  );

  if (!selectedCandidate) {
    throw new Error(`Unsupported catalog transport for ${model.providerId}/${model.id}: ${model.npm ?? provider.npm ?? "unknown"}`);
  }

  const family =
    selectedCandidate.kind === "anthropic"
      ? "anthropic"
      : selectedCandidate.kind === "gemini"
        ? "gemini"
        : "openai-compatible";

  const unifiedModel = {
    provider: model.providerId,
    modelId: model.id,
    family,
    transport: selectedCandidate.kind,
    runtimeProviderKey: selectedCandidate.runtimeProviderKey,
    baseURL: selectedCandidate.api ?? model.api ?? provider.api ?? resolveBaseURL(model.canonicalProviderId),
    apiKeyEnv: provider.env[0] ?? resolveApiKeyEnv(model.canonicalProviderId),
    providerFactory: selectedCandidate.providerFactory,
    supportsTools: model.toolCall,
    supportsReasoning: model.reasoning,
    supportsAttachments: model.attachment,
    contextWindow: model.contextWindow
  } satisfies UnifiedModel;

  if (!isSupportedUnifiedModel(unifiedModel)) {
    throw new Error(`Catalog model is not supported by mono: ${model.providerId}/${model.id}`);
  }

  return unifiedModel;
}
