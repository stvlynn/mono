import type { SlashCommandDefinition } from "./types.js";

export const BUILTIN_SLASH_COMMANDS: SlashCommandDefinition[] = [
  {
    name: "help",
    fullName: "/help",
    description: "Show command help",
    usage: "/help",
    kind: "action",
    source: "builtin",
    executeMode: "direct"
  },
  {
    name: "profile",
    fullName: "/profile",
    description: "Open profile selector",
    usage: "/profile [query]",
    aliases: ["profiles"],
    kind: "selector",
    source: "builtin",
    executeMode: "open-selector"
  },
  {
    name: "model",
    fullName: "/model",
    description: "Open model selector",
    usage: "/model [query]",
    aliases: ["models", "mdl"],
    kind: "selector",
    source: "builtin",
    executeMode: "open-selector"
  },
  {
    name: "auth",
    fullName: "/auth",
    description: "Show auth setup hint",
    usage: "/auth",
    kind: "action",
    source: "builtin",
    executeMode: "direct"
  },
  {
    name: "sessions",
    fullName: "/sessions",
    description: "Open session selector",
    usage: "/sessions [query]",
    aliases: ["session", "ses"],
    kind: "selector",
    source: "builtin",
    executeMode: "open-selector"
  },
  {
    name: "memory",
    fullName: "/memory",
    description: "Browse or search project memory",
    usage: "/memory [query]",
    aliases: ["mem"],
    kind: "selector",
    source: "builtin",
    executeMode: "open-selector"
  },
  {
    name: "tree",
    fullName: "/tree",
    description: "Open session tree",
    usage: "/tree [query]",
    aliases: ["branch", "branches", "tr"],
    kind: "selector",
    source: "builtin",
    executeMode: "open-selector"
  },
  {
    name: "quit",
    fullName: "/quit",
    description: "Exit mono",
    usage: "/quit",
    aliases: ["exit", "q"],
    kind: "action",
    source: "builtin",
    executeMode: "direct"
  },
  {
    name: "settings",
    fullName: "/settings",
    description: "Open settings and shortcuts help",
    usage: "/settings",
    aliases: ["config"],
    kind: "action",
    source: "builtin",
    executeMode: "direct"
  },
  {
    name: "resume",
    fullName: "/resume",
    description: "Resume a previous session",
    usage: "/resume [query]",
    aliases: ["continue"],
    kind: "selector",
    source: "builtin",
    executeMode: "open-selector"
  },
  {
    name: "clear",
    fullName: "/clear",
    description: "Clear the current screen state",
    usage: "/clear",
    kind: "action",
    source: "builtin",
    executeMode: "direct"
  },
  {
    name: "theme",
    fullName: "/theme",
    description: "Open theme preferences",
    usage: "/theme",
    kind: "action",
    source: "builtin",
    executeMode: "direct"
  }
];
