import { buildTelegramPairHelpLines, buildTelegramRuntimeHelpLines } from "./help.js";
import { createTelegramNotifier } from "./outbound.js";
import {
  approveTelegramPairingCode,
  allowTelegramUserId,
} from "./pairing-store.js";
import {
  buildTelegramStatusResult,
  saveTelegramBotId,
  saveTelegramBotToken,
  setTelegramEnabled,
} from "./config.js";
import type { TelegramCommandResult } from "./types.js";
import { buildTelegramApprovedText } from "./help.js";

export async function executePairCommand(
  rawArgs: string,
  cwd = process.cwd(),
): Promise<TelegramCommandResult> {
  const parsed = parsePairCommand(rawArgs);
  if (!parsed) {
    return {
      ok: false,
      title: "Telegram Pairing Help",
      lines: buildTelegramPairHelpLines(),
      status: "Pair command usage",
    };
  }

  switch (parsed.action) {
    case "code": {
      const approved = await approveTelegramPairingCode(parsed.value, cwd);
      if (!approved) {
        return {
          ok: false,
          title: "Telegram Pairing Approval",
          lines: [`No pending Telegram pairing request found for code ${parsed.value.toUpperCase()}.`],
          status: "Telegram pairing code not found",
        };
      }

      const notifier = await createTelegramNotifier(cwd);
      if (notifier) {
        await notifier.sendText(approved.senderId, buildTelegramApprovedText()).catch(() => {});
      }

      return {
        ok: true,
        title: "Telegram Pairing Approved",
        lines: [
          `Approved Telegram user ${approved.senderId}.`,
          approved.added
            ? "The user was added to the Telegram DM allowlist store."
            : "The user was already present in the Telegram DM allowlist store.",
        ],
        status: `Approved Telegram user ${approved.senderId}`,
      };
    }
    case "userid": {
      const approved = await allowTelegramUserId(parsed.value, cwd);
      return {
        ok: true,
        title: "Telegram User Allowlisted",
        lines: [
          `Allowlisted Telegram user ${approved.senderId}.`,
          approved.added
            ? "The user was added to the Telegram DM allowlist store."
            : "The user was already present in the Telegram DM allowlist store.",
        ],
        status: `Allowlisted Telegram user ${approved.senderId}`,
      };
    }
    case "botid":
      return saveTelegramBotId(parsed.value, cwd);
  }
}

export async function executeTelegramCommand(
  rawArgs: string,
  cwd = process.cwd(),
): Promise<TelegramCommandResult> {
  const parsed = parseTelegramCommand(rawArgs);
  if (!parsed) {
    return {
      ok: true,
      title: "Telegram Help",
      lines: buildTelegramRuntimeHelpLines(),
      status: "Telegram command usage",
    };
  }

  switch (parsed.action) {
    case "status":
      return buildTelegramStatusResult(cwd);
    case "token":
      return saveTelegramBotToken(parsed.value, cwd);
    case "enable":
      return setTelegramEnabled(true, cwd);
    case "disable":
      return setTelegramEnabled(false, cwd);
    case "help":
      return {
        ok: true,
        title: "Telegram Help",
        lines: buildTelegramRuntimeHelpLines(),
        status: "Telegram command usage",
      };
  }
}

type PairCommandAction = "code" | "userid" | "botid";

function parsePairCommand(rawArgs: string): { action: PairCommandAction; value: string } | null {
  const tokens = rawArgs.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 3 || tokens[0]?.toLowerCase() !== "telegram") {
    return null;
  }

  const action = tokens[1]?.toLowerCase();
  const value = tokens.slice(2).join(" ").trim();
  if (!value) {
    return null;
  }
  if (action !== "code" && action !== "userid" && action !== "botid") {
    return null;
  }
  return { action, value };
}

function parseTelegramCommand(
  rawArgs: string,
): { action: "status" | "token" | "enable" | "disable" | "help"; value: string } | null {
  const tokens = rawArgs.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return null;
  }

  const action = tokens[0]?.toLowerCase();
  if (action === "status" || action === "enable" || action === "disable" || action === "help") {
    return { action, value: "" };
  }
  if (action === "token") {
    const value = tokens.slice(1).join(" ").trim();
    return value ? { action, value } : null;
  }
  return null;
}
