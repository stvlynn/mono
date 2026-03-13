export interface ModelsCatalogCache {
  version: 1;
  fetchedAt: number;
  providers: Record<string, CatalogProvider>;
}

export interface RawCatalogProvider {
  id?: unknown;
  name?: unknown;
  env?: unknown;
  api?: unknown;
  npm?: unknown;
  doc?: unknown;
  models?: unknown;
}

export interface RawCatalogModel {
  id?: unknown;
  name?: unknown;
  tool_call?: unknown;
  reasoning?: unknown;
  temperature?: unknown;
  attachment?: unknown;
  limit?: unknown;
  provider?: unknown;
}

export type CatalogTransportKind = "openai-compatible" | "anthropic" | "gemini";

export interface CatalogTransportCandidate {
  kind: CatalogTransportKind;
  source: "catalog" | "runtime-override";
  api?: string;
  npm?: string;
  providerFactory?: "openai" | "anthropic" | "openrouter" | "google" | "custom";
  runtimeProviderKey?: string;
  supportedByMono: boolean;
  preferred?: boolean;
}

export interface CatalogProvider {
  id: string;
  canonicalId: string;
  name: string;
  env: string[];
  api?: string;
  npm?: string;
  doc?: string;
  catalogTransport?: CatalogTransportKind;
  transportCandidates?: CatalogTransportCandidate[];
  supported: boolean;
  models: Record<string, CatalogModel>;
}

export interface CatalogModel {
  id: string;
  name: string;
  providerId: string;
  canonicalProviderId: string;
  api?: string;
  npm?: string;
  catalogTransport?: CatalogTransportKind;
  transportCandidates?: CatalogTransportCandidate[];
  toolCall: boolean;
  reasoning: boolean;
  temperature: boolean;
  attachment: boolean;
  contextWindow?: number;
  supported: boolean;
}

export interface CatalogLoadOptions {
  refresh?: boolean;
  backgroundRefresh?: boolean;
}
