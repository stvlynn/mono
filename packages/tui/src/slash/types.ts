export type SlashCommandKind = "action" | "selector" | "input";
export type SlashCommandSource = "builtin" | "skill" | "project" | "extension";
export type SlashExecuteMode = "direct" | "open-selector" | "prefill-input";

export interface SlashCommandDefinition {
  name: string;
  fullName: string;
  description: string;
  usage?: string;
  aliases?: string[];
  kind: SlashCommandKind;
  source: SlashCommandSource;
  executeMode: SlashExecuteMode;
}

export interface SlashCommandMatch {
  command: SlashCommandDefinition;
  score: number;
  matchedRanges: Array<{ start: number; end: number }>;
}

export interface ParsedSlashInput {
  raw: string;
  trimmed: string;
  commandToken: string;
  commandName: string;
  argsText: string;
  hasTrailingSpace: boolean;
}
