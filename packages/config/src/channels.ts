import type {
  MonoTelegramActionsConfig,
  MonoChannelsConfig,
  MonoGlobalConfig,
  MonoTuiChannelConfig,
  MonoTelegramApprovalConfig,
  MonoTelegramConfig,
  MonoTelegramReplyConfig,
} from "@mono/shared";
import {
  normalizeTelegramActionsConfig,
  looksLikeTelegramBotToken,
  normalizeTelegramApprovalConfig,
  normalizeTelegramAllowFromEntries,
  normalizeTelegramBotId,
  normalizeTelegramGroupsConfig,
  normalizeTelegramReplyConfig,
} from "@mono/shared";

export function createDefaultTuiChannelConfig(): MonoTuiChannelConfig {
  return {
    enabled: true,
    renderer: "json-render-ink",
    specMode: "deterministic",
    validateGeneratedSpec: true,
    streamGeneratedSpec: false,
    debugRender: false,
  };
}

export function createDefaultTelegramActionsConfig(): MonoTelegramActionsConfig {
  return {
    send: true,
    sticker: true,
    photo: true,
    document: true,
    edit: true,
    delete: true,
    react: true,
  };
}

export function createDefaultTelegramApprovalConfig(): MonoTelegramApprovalConfig {
  return {
    allowChats: [],
    commandDenylist: [],
  };
}

export function createDefaultTelegramReplyConfig(): MonoTelegramReplyConfig {
  return {
    multiMessage: true,
    splitDelayMs: 800,
    stickers: {
      enabled: true,
      storePath: ".mono/telegram/stickers.json",
    },
  };
}

export function createDefaultTelegramConfig(): MonoTelegramConfig {
  return {
    enabled: false,
    botToken: undefined,
    botId: undefined,
    allowFrom: [],
    groupAllowFrom: [],
    groups: {},
    actions: createDefaultTelegramActionsConfig(),
    approval: createDefaultTelegramApprovalConfig(),
    reply: createDefaultTelegramReplyConfig(),
    dmPolicy: "pairing",
    pollingTimeoutSeconds: 20,
  };
}

export function createDefaultChannelsConfig(): MonoChannelsConfig {
  return {
    tui: createDefaultTuiChannelConfig(),
    telegram: createDefaultTelegramConfig(),
  };
}

export function resolveChannelsConfig(globalConfig: MonoGlobalConfig): MonoChannelsConfig {
  const defaults = createDefaultChannelsConfig();
  const tui = globalConfig.mono.channels?.tui;
  const telegram = globalConfig.mono.channels?.telegram;

  return {
    tui: {
      ...defaults.tui,
      ...tui,
      enabled: tui?.enabled ?? defaults.tui.enabled,
      renderer: tui?.renderer ?? defaults.tui.renderer,
      specMode: tui?.specMode ?? defaults.tui.specMode,
      validateGeneratedSpec: tui?.validateGeneratedSpec ?? defaults.tui.validateGeneratedSpec,
      streamGeneratedSpec: tui?.streamGeneratedSpec ?? defaults.tui.streamGeneratedSpec,
      debugRender: tui?.debugRender ?? defaults.tui.debugRender,
    },
    telegram: {
      ...defaults.telegram,
      ...telegram,
      botToken: telegram?.botToken?.trim() || undefined,
      botId: normalizeTelegramBotId(telegram?.botId),
      allowFrom: normalizeTelegramAllowFromEntries(telegram?.allowFrom),
      groupAllowFrom: normalizeTelegramAllowFromEntries(telegram?.groupAllowFrom),
      groups: normalizeTelegramGroupsConfig(telegram?.groups),
      actions: normalizeTelegramActionsConfig(telegram?.actions),
      approval: normalizeTelegramApprovalConfig(telegram?.approval),
      reply: normalizeTelegramReplyConfig(telegram?.reply),
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

export function validateTuiConfig(config: MonoTuiChannelConfig): void {
  if (config.renderer !== "json-render-ink") {
    throw new Error(`Unsupported mono.channels.tui.renderer: ${config.renderer}`);
  }
  if (config.specMode !== "deterministic" && config.specMode !== "generative") {
    throw new Error(`Unsupported mono.channels.tui.specMode: ${String(config.specMode)}`);
  }
}

export function validateChannelsConfig(globalConfig: MonoGlobalConfig): void {
  const resolved = resolveChannelsConfig(globalConfig);
  validateTuiConfig(resolved.tui);
  validateTelegramConfig(resolved.telegram);
}
