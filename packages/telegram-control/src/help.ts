import { type TelegramDisplayLanguage, t } from "./language.js";

export function buildTelegramPairHelpLines(language: TelegramDisplayLanguage = "en"): string[] {
  return [
    t(language, "pair_help_title"),
    "/pair telegram code <CODE>",
    "/pair telegram userid <USER_ID>",
    "/pair telegram botid <BOT_ID>",
    "",
    t(language, "pair_help_flow_title"),
    t(language, "pair_help_step_1"),
    t(language, "pair_help_step_2"),
    t(language, "pair_help_step_3"),
    t(language, "pair_help_step_4"),
    t(language, "pair_help_step_5"),
    "",
    t(language, "pair_help_footer"),
  ];
}

export function buildTelegramRuntimeHelpLines(language: TelegramDisplayLanguage = "en"): string[] {
  return [
    t(language, "runtime_help_title"),
    "/telegram status",
    "/telegram token <BOT_TOKEN>",
    "/telegram enable",
    "/telegram disable",
    "/model",
    "/cancel",
    "",
    t(language, "dm_pairing_default"),
    t(language, "group_allowlist_config"),
    t(language, "use_model_help"),
  ];
}

export function buildTelegramAuthorizedHelpText(language: TelegramDisplayLanguage = "en"): string {
  return [
    t(language, "control_title"),
    "",
    ...buildTelegramPairHelpLines(language),
    "",
    ...buildTelegramRuntimeHelpLines(language),
  ].join("\n");
}

export function buildTelegramPendingPairingText(params: {
  senderId: string;
  code: string;
}, language: TelegramDisplayLanguage = "en"): string {
  return [
    t(language, "pairing_not_configured"),
    "",
    t(language, "your_user_id", { senderId: params.senderId }),
    t(language, "pairing_code", { code: params.code }),
    "",
    t(language, "ask_owner_to_approve"),
    `/pair telegram code ${params.code}`,
    `mono pair telegram code ${params.code}`,
  ].join("\n");
}

export function buildTelegramAuthorizedStatusText(language: TelegramDisplayLanguage = "en"): string {
  return [
    t(language, "control_title"),
    "",
    t(language, "access_approved"),
    t(language, "use_model_help"),
    t(language, "use_help_line"),
  ].join("\n");
}

export function buildTelegramApprovedText(language: TelegramDisplayLanguage = "en"): string {
  return [
    t(language, "access_approved_short"),
    t(language, "if_tui_running"),
    t(language, "use_model_help"),
    t(language, "approved_help_footer"),
  ].join("\n");
}

export function buildTelegramGroupHelpText(chatId: string, isAllowedGroup: boolean, language: TelegramDisplayLanguage = "en"): string {
  const lines = [
    t(language, "group_help_title"),
    "",
    t(language, "current_group_chat_id", { chatId }),
  ];

  if (isAllowedGroup) {
    lines.push(t(language, "group_allowed"));
  } else {
    lines.push(t(language, "group_not_allowed"));
  }

  return lines.join("\n");
}
