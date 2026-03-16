export interface TelegramBotCommand {
  name: string;
  argsText: string;
}

export function parseTelegramBotCommand(
  text: string | undefined,
  botUsername: string | undefined,
): TelegramBotCommand | null {
  const trimmed = text?.trim();
  if (!trimmed?.startsWith("/")) {
    return null;
  }

  const [commandToken, ...rest] = trimmed.split(/\s+/u);
  const match = /^\/([a-z0-9_-]+)(?:@([A-Za-z0-9_]+))?$/iu.exec(commandToken);
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
