import type {
  MonoTelegramActionsConfig,
  MonoTelegramApprovalConfig,
  MonoTelegramConfig,
  MonoTelegramGroupConfig,
  MonoTelegramReplyConfig,
  MonoTelegramReplyStickersConfig,
  ToolExecutionChannel,
} from "./types.js";

const TELEGRAM_PREFIX_RE = /^(telegram|tg):/i;

export function stripTelegramPrefix(value: string): string {
  return value.trim().replace(TELEGRAM_PREFIX_RE, "").trim();
}

export function looksLikeTelegramBotToken(value: string | undefined): boolean {
  const trimmed = value?.trim() ?? "";
  return /^\d{3,}:[A-Za-z0-9_-]{10,}$/.test(trimmed);
}

export function normalizeTelegramUserId(
  value: string | number | undefined | null,
): string | undefined {
  const trimmed = stripTelegramPrefix(String(value ?? ""));
  if (!trimmed || !/^\d+$/.test(trimmed) || trimmed === "0") {
    return undefined;
  }
  return trimmed;
}

export function normalizeTelegramBotId(
  value: string | number | undefined | null,
): string | undefined {
  return normalizeTelegramUserId(value);
}

export function normalizeTelegramChatId(
  value: string | number | undefined | null,
): string | undefined {
  const trimmed = String(value ?? "").trim();
  if (!trimmed || !/^-?\d+$/.test(trimmed) || trimmed === "0") {
    return undefined;
  }
  return trimmed;
}

export function normalizeTelegramAllowFromEntries(
  values: ReadonlyArray<string | number> | undefined,
): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const value of values ?? []) {
    const next = normalizeTelegramUserId(value);
    if (!next || seen.has(next)) {
      continue;
    }
    seen.add(next);
    normalized.push(next);
  }

  return normalized;
}

export function normalizeTelegramGroupsConfig(
  groups: Record<string, MonoTelegramGroupConfig> | undefined,
): Record<string, MonoTelegramGroupConfig> {
  const normalized: Record<string, MonoTelegramGroupConfig> = {};

  for (const [rawChatId, groupConfig] of Object.entries(groups ?? {})) {
    const chatId = rawChatId === "*" ? "*" : normalizeTelegramChatId(rawChatId);
    if (!chatId) {
      continue;
    }
    normalized[chatId] = {
      allow: groupConfig.allow,
      requireMention: groupConfig.requireMention,
      allowFrom: normalizeTelegramAllowFromEntries(groupConfig.allowFrom),
    };
  }

  return normalized;
}

export function normalizeTelegramApprovalConfig(
  approval: Partial<MonoTelegramApprovalConfig> | undefined,
): MonoTelegramApprovalConfig {
  return {
    allowChats: normalizeTelegramChatEntries(approval?.allowChats),
    commandDenylist: normalizeCommandPatterns(approval?.commandDenylist),
  };
}

export function normalizeTelegramActionsConfig(
  actions: Partial<MonoTelegramActionsConfig> | undefined,
): MonoTelegramActionsConfig {
  return {
    send: actions?.send ?? true,
    sticker: actions?.sticker ?? true,
    photo: actions?.photo ?? true,
    document: actions?.document ?? true,
    edit: actions?.edit ?? true,
    delete: actions?.delete ?? true,
    react: actions?.react ?? true,
  };
}

export function normalizeTelegramReplyConfig(
  reply: Partial<MonoTelegramReplyConfig> | undefined,
): MonoTelegramReplyConfig {
  return {
    multiMessage: reply?.multiMessage ?? true,
    splitDelayMs: normalizePositiveInteger(reply?.splitDelayMs, 800),
    stickers: normalizeTelegramReplyStickersConfig(reply?.stickers),
  };
}

export function mergeTelegramAllowFrom(
  config: MonoTelegramConfig,
  storeAllowFrom: ReadonlyArray<string>,
): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();

  const pushEntry = (value: string | undefined) => {
    if (!value || seen.has(value)) {
      return;
    }
    seen.add(value);
    merged.push(value);
  };

  for (const value of config.allowFrom) {
    pushEntry(value);
  }

  if (config.dmPolicy === "pairing") {
    for (const value of storeAllowFrom) {
      pushEntry(normalizeTelegramUserId(value));
    }
  }

  return merged;
}

export function isTelegramSenderAllowed(
  senderId: string | undefined,
  allowFrom: ReadonlyArray<string>,
): boolean {
  const normalized = normalizeTelegramUserId(senderId);
  return normalized ? allowFrom.includes(normalized) : false;
}

export function telegramChatIdToToolExecutionChannel(chatId: string): ToolExecutionChannel | undefined {
  const normalized = normalizeTelegramChatId(chatId);
  if (!normalized) {
    return undefined;
  }

  return {
    platform: "telegram",
    kind: normalized.startsWith("-") ? "channel" : "dm",
    id: normalized,
  };
}

function normalizeTelegramChatEntries(values: ReadonlyArray<string | number> | undefined): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const value of values ?? []) {
    const next = normalizeTelegramChatId(value);
    if (!next || seen.has(next)) {
      continue;
    }
    seen.add(next);
    normalized.push(next);
  }

  return normalized;
}

function normalizeCommandPatterns(values: ReadonlyArray<string> | undefined): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const value of values ?? []) {
    const next = value.trim();
    if (!next || seen.has(next)) {
      continue;
    }
    seen.add(next);
    normalized.push(next);
  }

  return normalized;
}

function normalizeTelegramReplyStickersConfig(
  stickers: Partial<MonoTelegramReplyStickersConfig> | undefined,
): MonoTelegramReplyStickersConfig {
  return {
    enabled: stickers?.enabled ?? true,
    storePath: normalizeTelegramStickerStorePath(stickers?.storePath),
  };
}

function normalizeTelegramStickerStorePath(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized || ".mono/telegram/stickers.json";
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) {
    return fallback;
  }

  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : fallback;
}
