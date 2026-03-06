import type { ParsedSlashInput } from "./types.js";

export function parseSlashInput(raw: string): ParsedSlashInput | null {
  const trimmedStart = raw.trimStart();
  if (!trimmedStart.startsWith("/")) {
    return null;
  }

  const hasTrailingSpace = /\s$/.test(raw);
  const trimmed = trimmedStart.trim();
  const firstSpace = trimmed.indexOf(" ");
  const commandToken = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
  const commandName = commandToken.slice(1).toLowerCase();
  const argsText = firstSpace === -1 ? "" : trimmed.slice(firstSpace + 1).trim();

  return {
    raw,
    trimmed,
    commandToken,
    commandName,
    argsText,
    hasTrailingSpace
  };
}

export function isSlashInput(raw: string): boolean {
  return parseSlashInput(raw) !== null;
}
