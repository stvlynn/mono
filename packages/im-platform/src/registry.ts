import type { ImPlatformProvider } from "./types.js";

export class PlatformRegistry {
  readonly #providers = new Map<string, ImPlatformProvider>();

  constructor(providers: readonly ImPlatformProvider[] = []) {
    for (const provider of providers) {
      this.register(provider);
    }
  }

  register(provider: ImPlatformProvider): this {
    const existing = this.#providers.get(provider.id);
    if (existing) {
      throw new Error(`Dispatch provider already registered: ${provider.id}`);
    }
    this.#providers.set(provider.id, provider);
    return this;
  }

  resolve(id: string): ImPlatformProvider | undefined {
    return this.#providers.get(id);
  }

  list(): ImPlatformProvider[] {
    return [...this.#providers.values()];
  }
}

export function createPlatformRegistry(providers: readonly ImPlatformProvider[] = []): PlatformRegistry {
  return new PlatformRegistry(providers);
}
