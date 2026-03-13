import type { MonoMemoryV2Config } from "@mono/shared";

export function resolvePrimaryEntityId(config: MonoMemoryV2Config): string {
  return config.primaryEntityId.trim() || "primary-user";
}
