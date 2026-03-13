import type { MonoTelegramConfig } from "@mono/shared";
import {
  isTelegramSenderAllowed,
  mergeTelegramAllowFrom,
  normalizeTelegramUserId,
} from "@mono/shared";
import {
  buildTelegramAuthorizedHelpText,
  buildTelegramGroupHelpText,
  buildTelegramPendingPairingText,
} from "./help.js";
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
}): Promise<TelegramCommandResult | null> {
  const cwd = params.cwd ?? process.cwd();
  const command = parseTelegramBotCommand(params.message.text, params.botIdentity.username);

  if (params.message.chatType === "private") {
    return handlePrivateMessage({ cwd, config: params.config, message: params.message, command });
  }

  return handleGroupMessage({
    config: params.config,
    message: params.message,
    command,
  });
}

function parseTelegramBotCommand(
  text: string | undefined,
  botUsername: string | undefined,
): { name: string; argsText: string } | null {
  const trimmed = text?.trim();
  if (!trimmed?.startsWith("/")) {
    return null;
  }
  const [commandToken, ...rest] = trimmed.split(/\s+/);
  const match = /^\/([a-z0-9_-]+)(?:@([A-Za-z0-9_]+))?$/i.exec(commandToken);
  if (!match) {
    return null;
  }
  const mentionedBot = match[2]?.toLowerCase();
  if (mentionedBot && botUsername && mentionedBot !== botUsername.toLowerCase()) {
    return null;
  }
  return {
    name: match[1]!.toLowerCase(),
    argsText: rest.join(" ").trim(),
  };
}

async function handlePrivateMessage(params: {
  cwd: string;
  config: MonoTelegramConfig;
  message: TelegramIncomingMessage;
  command: { name: string; argsText: string } | null;
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

    return {
      ok: true,
      title: "Telegram Pairing Requested",
      lines: [buildTelegramPendingPairingText({ senderId, code: pairing.code })],
      status: `Issued Telegram pairing code for ${senderId}`,
    };
  }

  if (params.command?.name === "pair") {
    return executePairCommand(params.command.argsText, params.cwd);
  }

  if (params.command?.name === "help" || !params.command) {
    return {
      ok: true,
      title: "Telegram Help",
      lines: [buildTelegramAuthorizedHelpText()],
      status: "Sent Telegram help",
    };
  }

  return {
    ok: true,
    title: "Telegram Help",
    lines: [buildTelegramAuthorizedHelpText()],
    status: "Sent Telegram help",
  };
}

function handleGroupMessage(params: {
  config: MonoTelegramConfig;
  message: TelegramIncomingMessage;
  command: { name: string; argsText: string } | null;
}): TelegramCommandResult | null {
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

  return {
    ok: true,
    title: "Telegram Group Help",
    lines: [
      buildTelegramGroupHelpText(params.message.chatId, Boolean(groupConfig?.allow ?? groupConfig)),
    ],
    status: `Sent Telegram group help for ${params.message.chatId}`,
  };
}
