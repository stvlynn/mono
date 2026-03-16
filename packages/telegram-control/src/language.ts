import { readFileSync } from "node:fs";

export type TelegramDisplayLanguage = "en" | "zh";

type TelegramTextMap = Record<string, string>;

const LOCALES = {
  en: readLocaleJson("en"),
  zh: readLocaleJson("zh"),
} satisfies Record<TelegramDisplayLanguage, TelegramTextMap>;

function readLocaleJson(language: TelegramDisplayLanguage): TelegramTextMap {
  const url = new URL(`./locales/${language}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as TelegramTextMap;
}

export function inferTelegramDisplayLanguage(languageCode?: string): TelegramDisplayLanguage {
  const normalized = languageCode?.trim().toLowerCase();
  return normalized?.startsWith("zh") ? "zh" : "en";
}

export function t(
  language: TelegramDisplayLanguage,
  key: keyof typeof LOCALES.en,
  params: Record<string, string | number> = {},
): string {
  const template = LOCALES[language][key] ?? LOCALES.en[key];
  return template.replace(/\{([a-zA-Z0-9_]+)\}/gu, (_match, token) => {
    const value = params[token];
    return value === undefined ? `{${token}}` : String(value);
  });
}
