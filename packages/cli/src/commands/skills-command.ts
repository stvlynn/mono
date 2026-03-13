import { stdout as output } from "node:process";
import { Command } from "commander";
import { writeJson, writeLine } from "../output.js";
import { runSkillsList } from "../use-cases/skills.js";

export function registerSkillsCommand(program: Command): void {
  program
    .command("skills")
    .description("List project-local skills from .mono/skills")
    .argument("[query]", "filter skills by name, description, or content")
    .option("--json", "output JSON")
    .action(async (query: string | undefined, options) => {
      const payload = await runSkillsList(query);
      if (options.json) {
        writeJson(payload);
        return;
      }

      if (payload.skills.length === 0) {
        writeLine("No project skills found.");
        return;
      }

      for (const skill of payload.skills) {
        output.write(`${skill.name}\n`);
        output.write(`  description: ${skill.description || "<none>"}\n`);
        output.write(`  path: ${skill.location}\n`);
      }
    });
}
