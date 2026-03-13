import { ProviderNotFoundError } from "./errors.js";
import { createBuiltInProviders, type BuiltInProviderConfig } from "./built-in.js";
import { createPlatformRegistry, PlatformRegistry } from "./registry.js";
import type { DispatchRequest, DispatchResult, ImPlatformProvider } from "./types.js";

export interface Distributor {
  dispatch(request: DispatchRequest): Promise<DispatchResult>;
  register(provider: ImPlatformProvider): Distributor;
  listProviders(): ImPlatformProvider[];
}

class DefaultDistributor implements Distributor {
  readonly #registry: PlatformRegistry;

  constructor(registry: PlatformRegistry) {
    this.#registry = registry;
  }

  register(provider: ImPlatformProvider): Distributor {
    this.#registry.register(provider);
    return this;
  }

  listProviders(): ImPlatformProvider[] {
    return this.#registry.list();
  }

  async dispatch(request: DispatchRequest): Promise<DispatchResult> {
    const provider = this.#registry.resolve(request.provider);
    if (!provider) {
      throw new ProviderNotFoundError(request.provider);
    }
    return provider.dispatch(request);
  }
}

export function createDistributor(options?: {
  registry?: PlatformRegistry;
  providers?: readonly ImPlatformProvider[];
  builtInProviders?: readonly BuiltInProviderConfig[];
}): Distributor {
  const registry =
    options?.registry
    ?? createPlatformRegistry([
      ...(options?.providers ?? []),
      ...createBuiltInProviders(options?.builtInProviders ?? []),
    ]);

  return new DefaultDistributor(registry);
}
