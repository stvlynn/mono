import { stdout as output } from "node:process";
import { Command } from "commander";
import { writeJson, writeLine } from "../output.js";
import { runSkillsAdd, runSkillsFind, runSkillsList } from "../use-cases/skills.js";

function formatInstallCount(installs: number): string {
  if (installs <= 0) {
    return "0 installs";
  }
  if (installs >= 1000) {
    return `${(installs / 1000).toFixed(installs >= 10_000 ? 0 : 1).replace(/\.0$/u, "")}k installs`;
  }
  return `${installs} install${installs === 1 ? "" : "s"}`;
}

function extractJsonFlag(query: string[] | undefined, options: { json?: boolean }): { json: boolean; query: string | undefined } {
  const normalizedQuery = (query ?? []).filter((token) => token !== "--json");
  return {
    json: Boolean(options.json) || (query ?? []).includes("--json"),
    query: normalizedQuery.length > 0 ? normalizedQuery.join(" ") : undefined
  };
}

function resolveCommandJson(command: Command, query: string[] | undefined): { json: boolean; query: string | undefined } {
  const parentOptions = command.parent?.opts<{ json?: boolean }>() ?? {};
  return extractJsonFlag(query, {
    json: Boolean(command.opts<{ json?: boolean }>().json) || Boolean(parentOptions.json)
  });
}

export function registerSkillsCommand(program: Command): void {
  const skillsCommand = program
    .command("skills")
    .description("List, find, and install mono skills")
    .argument("[query...]", "filter available skills by name, description, origin, or content")
    .option("--json", "output JSON")
    .action(async function (this: Command, query: string[] | undefined) {
      const parsed = extractJsonFlag(query, this.opts<{ json?: boolean }>());
      const payload = await runSkillsList(parsed.query);
      if (parsed.json) {
        writeJson(payload);
        return;
      }

      if (payload.skills.length === 0) {
        writeLine("No builtin, global, or project skills found.");
        return;
      }

      for (const skill of payload.skills) {
        output.write(`${skill.name}\n`);
        output.write(`  origin: ${skill.origin}\n`);
        output.write(`  description: ${skill.description || "<none>"}\n`);
        output.write(`  path: ${skill.location}\n`);
      }
    });

  skillsCommand
    .command("list")
    .description("List builtin, global, and project skills")
    .argument("[query...]", "filter available skills by name, description, origin, or content")
    .action(async function (this: Command, query: string[] | undefined) {
      const parsed = resolveCommandJson(this, query);
      const payload = await runSkillsList(parsed.query);
      if (parsed.json) {
        writeJson(payload);
        return;
      }

      if (payload.skills.length === 0) {
        writeLine("No builtin, global, or project skills found.");
        return;
      }

      for (const skill of payload.skills) {
        output.write(`${skill.name}\n`);
        output.write(`  origin: ${skill.origin}\n`);
        output.write(`  description: ${skill.description || "<none>"}\n`);
        output.write(`  path: ${skill.location}\n`);
      }
    });

  skillsCommand
    .command("find")
    .description("Search the remote skills registry")
    .argument("<query...>", "search query")
    .action(async function (this: Command, query: string[]) {
      const parsed = resolveCommandJson(this, query);
      const payload = await runSkillsFind(parsed.query ?? "");
      if (parsed.json) {
        writeJson(payload);
        return;
      }

      if (payload.results.length === 0) {
        writeLine(`No remote skills found for "${payload.query}".`);
        return;
      }

      for (const result of payload.results) {
        output.write(`${result.name}\n`);
        output.write(`  source: ${result.source}\n`);
        output.write(`  installs: ${formatInstallCount(result.installs)}\n`);
        output.write(`  install: mono skills add ${result.installSource}\n`);
        output.write(`  url: ${result.url}\n`);
      }
    });

  skillsCommand
    .command("add")
    .description("Install a remote skill into ~/.mono/skills")
    .argument("<source>", "skill source such as owner/repo@skill-name")
    .action(async function (this: Command, source: string) {
      const payload = await runSkillsAdd(source);
      if (this.parent?.opts<{ json?: boolean }>().json) {
        writeJson(payload);
        return;
      }

      writeLine(`${payload.replacedExisting ? "Updated" : "Installed"} ${payload.skill.name}`);
      writeLine(`  source: ${payload.source}`);
      writeLine(`  install dir: ${payload.installDir}`);
      writeLine(`  metadata: ${payload.metadataPath}`);
    });
}
