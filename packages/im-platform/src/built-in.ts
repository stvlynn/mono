import type { ImPlatformProvider } from "./types.js";
import { createTelegramPlatformAdapter } from "./platforms/telegram/telegram-platform-adapter.js";
import type { TelegramPlatformAdapterConfig } from "./platforms/telegram/types.js";

export type BuiltInProviderConfig = TelegramPlatformAdapterConfig;

export function createBuiltInProvider(config: BuiltInProviderConfig): ImPlatformProvider {
  switch (config.platform) {
    case "telegram":
      return createTelegramPlatformAdapter(config);
  }
}

export function createBuiltInProviders(configs: readonly BuiltInProviderConfig[]): ImPlatformProvider[] {
  return configs.map((config) => createBuiltInProvider(config));
}
