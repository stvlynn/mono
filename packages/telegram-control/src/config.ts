import { MonoConfigStore, resolveMonoConfig, validateChannelsConfig } from "@mono/config";
import type { MonoGlobalConfig, MonoTelegramConfig } from "@mono/shared";
import { normalizeTelegramBotId } from "@mono/shared";
import { listTelegramPairingRequests, readTelegramAllowFromStore } from "./pairing-store.js";
import type { TelegramCommandResult } from "./types.js";

export async function loadTelegramConfig(cwd = process.cwd()): Promise<MonoTelegramConfig> {
  const resolved = await resolveMonoConfig({ cwd });
  return resolved.channels.telegram;
}

export async function saveTelegramBotToken(
  token: string,
  cwd = process.cwd(),
): Promise<TelegramCommandResult> {
  await updateTelegramGlobalConfig(cwd, (config) => {
    config.enabled = true;
    config.botToken = token.trim();
  });

  const store = new MonoConfigStore(cwd);
  return {
    ok: true,
    title: "Telegram Config Updated",
    lines: [
      "Saved Telegram bot token.",
      `Config file: ${store.paths.globalConfigPath}`,
      "Telegram control runtime will start automatically in the TUI when enabled.",
    ],
    status: "Saved Telegram bot token",
    shouldReloadRuntime: true,
  };
}

export async function setTelegramEnabled(
  enabled: boolean,
  cwd = process.cwd(),
): Promise<TelegramCommandResult> {
  await updateTelegramGlobalConfig(cwd, (config) => {
    config.enabled = enabled;
  });

  return {
    ok: true,
    title: "Telegram Config Updated",
    lines: [
      enabled ? "Telegram control runtime is enabled." : "Telegram control runtime is disabled.",
    ],
    status: enabled ? "Enabled Telegram runtime" : "Disabled Telegram runtime",
    shouldReloadRuntime: true,
  };
}

export async function saveTelegramBotId(
  botId: string,
  cwd = process.cwd(),
): Promise<TelegramCommandResult> {
  const normalized = normalizeTelegramBotId(botId);
  if (!normalized) {
    return {
      ok: false,
      title: "Telegram Bot Id",
      lines: ["Telegram bot id must be a positive numeric Telegram user id."],
      status: "Invalid Telegram bot id",
    };
  }

  await updateTelegramGlobalConfig(cwd, (config) => {
    config.botId = normalized;
  });

  const store = new MonoConfigStore(cwd);
  return {
    ok: true,
    title: "Telegram Bot Id Saved",
    lines: [
      `Saved Telegram bot id: ${normalized}`,
      `Config file: ${store.paths.globalConfigPath}`,
    ],
    status: `Saved Telegram bot id ${normalized}`,
    shouldReloadRuntime: true,
  };
}

export async function buildTelegramStatusResult(
  cwd = process.cwd(),
): Promise<TelegramCommandResult> {
  const store = new MonoConfigStore(cwd);
  const config = await loadTelegramConfig(cwd);
  const pending = await listTelegramPairingRequests(cwd);
  const allowFromStore = await readTelegramAllowFromStore(cwd);

  return {
    ok: true,
    title: "Telegram Status",
    lines: [
      `Enabled: ${config.enabled ? "yes" : "no"}`,
      `Bot token configured: ${config.botToken ? "yes" : "no"}`,
      `Configured bot id: ${config.botId ?? "<not set>"}`,
      `DM policy: ${config.dmPolicy}`,
      `Config allowFrom: ${config.allowFrom.length > 0 ? config.allowFrom.join(", ") : "<none>"}`,
      `Approval allowChats: ${config.approval.allowChats.length > 0 ? config.approval.allowChats.join(", ") : "<none>"}`,
      `Approval command denylist: ${config.approval.commandDenylist.length > 0 ? config.approval.commandDenylist.join(", ") : "<none>"}`,
      `Stored approvals: ${allowFromStore.length > 0 ? allowFromStore.join(", ") : "<none>"}`,
      `Pending pairing requests: ${pending.length}`,
      `Config file: ${store.paths.globalConfigPath}`,
      `State dir: ${store.paths.globalStateDir}`,
    ],
    status: "Loaded Telegram status",
  };
}

async function updateTelegramGlobalConfig(
  cwd: string,
  mutate: (config: Partial<MonoTelegramConfig>) => void,
): Promise<MonoGlobalConfig> {
  const store = new MonoConfigStore(cwd);
  const config = (await store.readGlobalConfig()) ?? (await store.initGlobalConfig());
  const telegramConfig: Partial<MonoTelegramConfig> = {
    ...(config.mono.channels?.telegram ?? {}),
  };
  mutate(telegramConfig);
  config.mono.channels = {
    ...(config.mono.channels ?? {}),
    telegram: telegramConfig as MonoTelegramConfig,
  };
  validateChannelsConfig(config);
  await store.writeGlobalConfig(config);
  return config;
}
