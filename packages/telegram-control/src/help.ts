export function buildTelegramPairHelpLines(): string[] {
  return [
    "Telegram pairing commands:",
    "/pair telegram code <CODE>",
    "/pair telegram userid <USER_ID>",
    "/pair telegram botid <BOT_ID>",
    "",
    "Typical flow:",
    "1. Configure the bot token: mono telegram token <BOT_TOKEN>",
    "2. Start mono TUI so the Telegram control runtime is polling.",
    "3. A new user DMs the bot and receives a pairing code.",
    "4. Approve from the platform with /pair telegram code <CODE>.",
    "5. The user is added to the Telegram DM allowlist store.",
    "",
    "Use /telegram status to inspect the active Telegram configuration.",
  ];
}

export function buildTelegramRuntimeHelpLines(): string[] {
  return [
    "Telegram runtime commands:",
    "/telegram status",
    "/telegram token <BOT_TOKEN>",
    "/telegram enable",
    "/telegram disable",
    "",
    "DM pairing is the default policy. Unknown Telegram DM senders receive a short pairing code.",
    "Group allowlists are configured under mono.channels.telegram.groups in ~/.mono/config.json.",
  ];
}

export function buildTelegramAuthorizedHelpText(): string {
  return [
    "mono Telegram control",
    "",
    ...buildTelegramPairHelpLines(),
    "",
    ...buildTelegramRuntimeHelpLines(),
  ].join("\n");
}

export function buildTelegramPendingPairingText(params: {
  senderId: string;
  code: string;
}): string {
  return [
    "mono Telegram access is not configured.",
    "",
    `Your Telegram user id: ${params.senderId}`,
    `Pairing code: ${params.code}`,
    "",
    "Ask the owner to approve with:",
    `/pair telegram code ${params.code}`,
    `mono pair telegram code ${params.code}`,
  ].join("\n");
}

export function buildTelegramAuthorizedStatusText(): string {
  return [
    "mono Telegram control",
    "",
    "Access is approved.",
    "This runtime currently supports Telegram control commands only.",
    "Use /help to list the available commands.",
  ].join("\n");
}

export function buildTelegramApprovedText(): string {
  return [
    "Telegram access approved.",
    "If mono TUI is running, you can message the bot now.",
    "Use /help to see the available Telegram control commands.",
  ].join("\n");
}

export function buildTelegramGroupHelpText(chatId: string, isAllowedGroup: boolean): string {
  const lines = [
    "mono Telegram group help",
    "",
    `Current group chat id: ${chatId}`,
  ];

  if (isAllowedGroup) {
    lines.push("This group is already allowed by configuration.");
  } else {
    lines.push('This group is not allowlisted yet. Add it under mono.channels.telegram.groups in ~/.mono/config.json.');
  }

  return lines.join("\n");
}
