import type {
  MonoChannelsConfig,
  MonoGlobalConfig,
  MonoTelegramConfig,
} from "@mono/shared";
import {
  looksLikeTelegramBotToken,
  normalizeTelegramAllowFromEntries,
  normalizeTelegramBotId,
  normalizeTelegramGroupsConfig,
} from "@mono/shared";

export function createDefaultTelegramConfig(): MonoTelegramConfig {
  return {
    enabled: false,
    botToken: undefined,
    botId: undefined,
    allowFrom: [],
    groupAllowFrom: [],
    groups: {},
    dmPolicy: "pairing",
    pollingTimeoutSeconds: 20,
  };
}

export function createDefaultChannelsConfig(): MonoChannelsConfig {
  return {
    telegram: createDefaultTelegramConfig(),
  };
}

export function resolveChannelsConfig(globalConfig: MonoGlobalConfig): MonoChannelsConfig {
  const defaults = createDefaultChannelsConfig();
  const telegram = globalConfig.mono.channels?.telegram;

  return {
    telegram: {
      ...defaults.telegram,
      ...telegram,
      botToken: telegram?.botToken?.trim() || undefined,
      botId: normalizeTelegramBotId(telegram?.botId),
      allowFrom: normalizeTelegramAllowFromEntries(telegram?.allowFrom),
      groupAllowFrom: normalizeTelegramAllowFromEntries(telegram?.groupAllowFrom),
      groups: normalizeTelegramGroupsConfig(telegram?.groups),
    },
  };
}

export function validateTelegramConfig(config: MonoTelegramConfig): void {
  if (config.enabled) {
    if (!config.botToken) {
      throw new Error("Telegram requires mono.channels.telegram.botToken when enabled");
    }
    if (!looksLikeTelegramBotToken(config.botToken)) {
      throw new Error("Telegram bot token must look like a Bot API token");
    }
  }

  if (config.botId && !normalizeTelegramBotId(config.botId)) {
    throw new Error("Telegram bot id must be a positive numeric Telegram user id");
  }

  if (config.dmPolicy === "allowlist" && config.allowFrom.length === 0) {
    throw new Error(
      "Telegram dmPolicy=allowlist requires at least one mono.channels.telegram.allowFrom entry",
    );
  }
}

export function validateChannelsConfig(globalConfig: MonoGlobalConfig): void {
  const resolved = resolveChannelsConfig(globalConfig);
  validateTelegramConfig(resolved.telegram);
}
