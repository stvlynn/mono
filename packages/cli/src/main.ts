import { Command } from "commander";
import { registerAuthCommands } from "./commands/auth-commands.js";
import { registerConfigCommands } from "./commands/config-commands.js";
import { registerContextCommand } from "./commands/context-command.js";
import { registerMemoryCommands } from "./commands/memory-commands.js";
import { registerModelsCommand } from "./commands/models-command.js";
import { registerRootCommand } from "./commands/root-command.js";
import { registerSkillsCommand } from "./commands/skills-command.js";

export async function main(argv: string[]): Promise<void> {
  const program = new Command();

  registerRootCommand(program);
  registerAuthCommands(program);
  registerConfigCommands(program);
  registerContextCommand(program);
  registerModelsCommand(program);
  registerMemoryCommands(program);
  registerSkillsCommand(program);

  await program.parseAsync(argv, { from: "user" });
}
