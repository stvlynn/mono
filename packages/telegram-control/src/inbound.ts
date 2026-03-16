import { parseTelegramBotCommand } from "./bot-command.js";
import type { MonoTelegramConfig } from "@mono/shared";
import {
  isTelegramSenderAllowed,
  mergeTelegramAllowFrom,
  normalizeTelegramUserId,
} from "@mono/shared";
import {
  buildTelegramAuthorizedHelpText,
  buildTelegramAuthorizedStatusText,
  buildTelegramGroupHelpText,
  buildTelegramPendingPairingText,
} from "./help.js";
import { buildTelegramModelEntryActions, resolveTelegramUiLanguage } from "./model-config.js";
import { executePairCommand } from "./commands.js";
import { readTelegramAllowFromStore, upsertTelegramPairingRequest } from "./pairing-store.js";
import type {
  TelegramBotIdentity,
  TelegramCommandResult,
  TelegramIncomingMessage,
} from "./types.js";
export async function processTelegramIncomingMessage(params: {
  cwd?: string;
  config: MonoTelegramConfig;
  botIdentity: TelegramBotIdentity;
  message: TelegramIncomingMessage;
  authorizedMessageMode?: "control" | "chat";
}): Promise<TelegramCommandResult | null> {
  const cwd = params.cwd ?? process.cwd();
  const command = parseTelegramBotCommand(params.message.text, params.botIdentity.username);

  if (params.message.chatType === "private") {
    return handlePrivateMessage({
      cwd,
      config: params.config,
      message: params.message,
      command,
      authorizedMessageMode: params.authorizedMessageMode ?? "control",
    });
  }

  return handleGroupMessage({
    config: params.config,
    message: params.message,
    command,
  });
}

async function handlePrivateMessage(params: {
  cwd: string;
  config: MonoTelegramConfig;
  message: TelegramIncomingMessage;
  command: { name: string; argsText: string } | null;
  authorizedMessageMode: "control" | "chat";
}): Promise<TelegramCommandResult | null> {
  const storeAllowFrom = await readTelegramAllowFromStore(params.cwd);
  const effectiveAllowFrom = mergeTelegramAllowFrom(params.config, storeAllowFrom);
  const senderAllowed = isTelegramSenderAllowed(params.message.senderId, effectiveAllowFrom);

  if (!senderAllowed) {
    if (params.config.dmPolicy !== "pairing") {
      return null;
    }

    const senderId = normalizeTelegramUserId(params.message.senderId ?? params.message.chatId);
    if (!senderId) {
      return null;
    }

    const pairing = await upsertTelegramPairingRequest(
      {
        senderId,
        username: params.message.username,
        displayName: params.message.displayName,
      },
      params.cwd,
    );
    if (!pairing.created || !pairing.code) {
      return null;
    }

    const language = await resolveTelegramUiLanguage({
      cwd: params.cwd,
      senderId,
      languageCode: params.message.languageCode,
    });

    return {
      ok: true,
      title: "Telegram Pairing Requested",
      lines: [buildTelegramPendingPairingText({ senderId, code: pairing.code }, language)],
      status: `Issued Telegram pairing code for ${senderId}`,
    };
  }

  const language = await resolveTelegramUiLanguage({
    cwd: params.cwd,
    senderId: params.message.senderId,
    languageCode: params.message.languageCode,
  });

  if (params.command?.name === "pair") {
    return executePairCommand(params.command.argsText, params.cwd);
  }

  if (params.command?.name === "help" || !params.command) {
    if (!params.command && params.authorizedMessageMode === "chat") {
      return {
        ok: true,
        title: "Telegram Chat Handoff",
        lines: [],
        status: "Authorized Telegram message handed off to chat",
        handoffToChat: true,
      };
    }
    return {
      ok: true,
      title: "Telegram Control",
      lines: [params.command ? buildTelegramAuthorizedHelpText(language) : buildTelegramAuthorizedStatusText(language)],
      status: params.command ? "Sent Telegram help" : "Sent Telegram control status",
      actions: buildTelegramModelEntryActions(language),
    };
  }

  if (params.authorizedMessageMode === "chat") {
    return {
      ok: true,
      title: "Telegram Chat Handoff",
      lines: [],
      status: "Authorized Telegram message handed off to chat",
      handoffToChat: true,
    };
  }

  return {
    ok: true,
    title: "Telegram Control",
    lines: [buildTelegramAuthorizedStatusText(language)],
    status: "Sent Telegram control status",
    actions: buildTelegramModelEntryActions(language),
  };
}

function handleGroupMessage(params: {
  config: MonoTelegramConfig;
  message: TelegramIncomingMessage;
  command: { name: string; argsText: string } | null;
}): Promise<TelegramCommandResult | null> | TelegramCommandResult | null {
  if (!params.command || params.command.name !== "help") {
    return null;
  }

  const isOwner = isTelegramSenderAllowed(params.message.senderId, params.config.groupAllowFrom)
    || isTelegramSenderAllowed(params.message.senderId, params.config.allowFrom);
  if (!isOwner) {
    return null;
  }

  const groupConfig =
    params.config.groups[params.message.chatId]
    ?? params.config.groups["*"];

  const language = params.message.languageCode?.toLowerCase().startsWith("zh") ? "zh" : "en";
  return {
    ok: true,
    title: "Telegram Group Help",
    lines: [
      buildTelegramGroupHelpText(params.message.chatId, Boolean(groupConfig?.allow ?? groupConfig), language),
    ],
    status: `Sent Telegram group help for ${params.message.chatId}`,
  };
}
