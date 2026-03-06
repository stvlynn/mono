import { BUILTIN_SLASH_COMMANDS } from "./commands.js";
import { fuzzyScore } from "./fuzzy.js";
import type { SlashCommandDefinition, SlashCommandMatch } from "./types.js";

function normalize(value: string): string {
  return value.trim().replace(/^\//, "").toLowerCase();
}

export class SlashCommandRegistry {
  private readonly commands = new Map<string, SlashCommandDefinition>();
  private readonly aliases = new Map<string, SlashCommandDefinition>();

  constructor(initialCommands: SlashCommandDefinition[] = BUILTIN_SLASH_COMMANDS) {
    this.registerMany(initialCommands);
  }

  register(command: SlashCommandDefinition): void {
    this.commands.set(command.name, command);
    this.commands.set(command.fullName, command);
    for (const alias of command.aliases ?? []) {
      this.aliases.set(normalize(alias), command);
      this.aliases.set(normalize(`/${alias}`), command);
    }
  }

  registerMany(commands: SlashCommandDefinition[]): void {
    for (const command of commands) {
      this.register(command);
    }
  }

  list(): SlashCommandDefinition[] {
    const unique = new Map<string, SlashCommandDefinition>();
    for (const command of this.commands.values()) {
      unique.set(command.name, command);
    }
    return [...unique.values()].sort((left, right) => left.fullName.localeCompare(right.fullName));
  }

  find(nameOrAlias: string): SlashCommandDefinition | undefined {
    const normalized = normalize(nameOrAlias);
    return this.commands.get(normalized) ?? this.commands.get(`/${normalized}`) ?? this.aliases.get(normalized);
  }

  search(query: string): SlashCommandMatch[] {
    const normalized = normalize(query);
    const matches: SlashCommandMatch[] = [];

    for (const command of this.list()) {
      if (!normalized) {
        matches.push({ command, score: 1, matchedRanges: [] });
        continue;
      }

      const candidates = [
        { value: command.fullName, bonus: 0 },
        { value: command.name, bonus: 25 },
        ...(command.aliases ?? []).map((alias) => ({ value: alias, bonus: 10 }))
      ];

      let best: SlashCommandMatch | null = null;
      for (const candidate of candidates) {
        const match = fuzzyScore(normalized, candidate.value);
        if (!match) {
          continue;
        }
        const next: SlashCommandMatch = {
          command,
          score: match.score + candidate.bonus,
          matchedRanges: match.matchedRanges
        };
        if (!best || next.score > best.score) {
          best = next;
        }
      }

      if (best) {
        matches.push(best);
      }
    }

    return matches.sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.command.fullName.localeCompare(right.command.fullName);
    });
  }
}
