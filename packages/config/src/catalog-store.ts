import { readJsonFile, writeJsonFile } from "@mono/shared";
import { getMonoConfigPaths } from "./paths.js";
import { createBuiltinCatalog, normalizeCatalog, rehydrateCatalog } from "./catalog-normalizer.js";
import type { CatalogLoadOptions, CatalogModel, CatalogProvider, ModelsCatalogCache, RawCatalogProvider } from "./catalog-types.js";
import { canonicalizeProviderId } from "./defaults.js";

const DEFAULT_MODELS_CATALOG_URL = process.env.MONO_MODELS_CATALOG_URL ?? "https://models.dev/api.json";
const DEFAULT_REFRESH_TTL_MS = Number(process.env.MONO_MODELS_CATALOG_TTL_MS ?? 60 * 60 * 1000);
const DEFAULT_FETCH_TIMEOUT_MS = Number(process.env.MONO_MODELS_CATALOG_TIMEOUT_MS ?? 10_000);

const backgroundRefreshes = new Map<string, Promise<void>>();

export async function getModelsCatalog(
  cwd = process.cwd(),
  options: CatalogLoadOptions = {}
): Promise<Record<string, CatalogProvider>> {
  if (options.refresh) {
    return refreshModelsCatalog(cwd);
  }

  const cache = await readCatalogCache(cwd);
  if (cache?.providers && Object.keys(cache.providers).length > 0) {
    const providers = rehydrateCatalog(cache.providers);
    if (options.backgroundRefresh !== false && shouldRefreshInBackground(cache)) {
      scheduleBackgroundRefresh(cwd);
    }
    return providers;
  }

  if (!allowNetworkFetch()) {
    return createBuiltinCatalog();
  }

  try {
    return await refreshModelsCatalog(cwd);
  } catch {
    return createBuiltinCatalog();
  }
}

export async function refreshModelsCatalog(cwd = process.cwd()): Promise<Record<string, CatalogProvider>> {
  const response = await fetch(DEFAULT_MODELS_CATALOG_URL, {
    signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
    headers: {
      "User-Agent": "mono-model-catalog/0.1.0"
    }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch models catalog: ${response.status} ${response.statusText}`);
  }

  const raw = (await response.json()) as Record<string, RawCatalogProvider>;
  const providers = normalizeCatalog(raw);
  const cachePath = getMonoConfigPaths(cwd).globalModelsCatalogPath;
  await writeJsonFile(cachePath, {
    version: 1,
    fetchedAt: Date.now(),
    providers
  } satisfies ModelsCatalogCache);
  return providers;
}

export async function listCatalogProviders(
  cwd = process.cwd(),
  options: CatalogLoadOptions = {}
): Promise<CatalogProvider[]> {
  const providers = Object.values(await getModelsCatalog(cwd, options)).filter(
    (provider) => provider.supported && Object.values(provider.models).some((model) => model.supported)
  );
  return providers.sort((left, right) => left.name.localeCompare(right.name));
}

export async function listCatalogModels(
  cwd = process.cwd(),
  providerId?: string,
  options: CatalogLoadOptions = {}
): Promise<CatalogModel[]> {
  const providers = await getModelsCatalog(cwd, options);
  if (providerId) {
    const provider = providers[canonicalizeProviderId(providerId)] ?? providers[providerId];
    if (!provider) {
      return [];
    }
    return Object.values(provider.models)
      .filter((model) => model.supported)
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  return Object.values(providers)
    .filter((provider) => provider.supported)
    .flatMap((provider) => Object.values(provider.models))
    .filter((model) => model.supported)
    .sort((left, right) => {
      const providerCompare = left.providerId.localeCompare(right.providerId);
      return providerCompare === 0 ? left.id.localeCompare(right.id) : providerCompare;
    });
}

export async function getCatalogProvider(
  cwd = process.cwd(),
  providerId: string,
  options: CatalogLoadOptions = {}
): Promise<CatalogProvider | undefined> {
  const providers = await getModelsCatalog(cwd, options);
  return providers[canonicalizeProviderId(providerId)] ?? providers[providerId];
}

export async function getCatalogModel(
  cwd = process.cwd(),
  providerId: string,
  modelId: string,
  options: CatalogLoadOptions = {}
): Promise<CatalogModel | undefined> {
  const provider = await getCatalogProvider(cwd, providerId, options);
  return provider?.models[modelId];
}

async function readCatalogCache(cwd: string): Promise<ModelsCatalogCache | undefined> {
  return readJsonFile<ModelsCatalogCache>(getMonoConfigPaths(cwd).globalModelsCatalogPath);
}

function shouldRefreshInBackground(cache: ModelsCatalogCache): boolean {
  if (!allowNetworkFetch()) {
    return false;
  }
  return Date.now() - cache.fetchedAt > DEFAULT_REFRESH_TTL_MS;
}

function scheduleBackgroundRefresh(cwd: string): void {
  const cachePath = getMonoConfigPaths(cwd).globalModelsCatalogPath;
  if (backgroundRefreshes.has(cachePath)) {
    return;
  }

  const refresh = refreshModelsCatalog(cwd)
    .then(() => undefined, () => undefined)
    .finally(() => {
      backgroundRefreshes.delete(cachePath);
    });
  backgroundRefreshes.set(cachePath, refresh);
}

function allowNetworkFetch(): boolean {
  return !process.env.VITEST && process.env.NODE_ENV !== "test";
}
