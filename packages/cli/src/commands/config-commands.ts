import { stdout as output } from "node:process";
import { Command } from "commander";
import { runBindProject, runConfigGet, runConfigInit, runConfigList, runConfigMigrate, runConfigSet } from "../use-cases/config.js";
import { writeJson, writeLine } from "../output.js";

export function registerConfigCommands(program: Command): void {
  const config = program.command("config").description("Manage ~/.mono configuration");

  config
    .command("init")
    .description("Initialize ~/.mono directory structure")
    .action(async () => {
      const result = await runConfigInit();
      output.write(`Initialized ${result.dir}\n`);
      output.write(`Default profile: ${result.defaultProfile}\n`);
    });

  config
    .command("migrate")
    .description("Migrate legacy configuration into ~/.mono")
    .option("--cleanup", "delete legacy files after a successful migration")
    .action(async (options) => {
      writeJson(await runConfigMigrate(Boolean(options.cleanup)));
    });

  config
    .command("get")
    .description("Get a value from ~/.mono/config.json")
    .argument("<key>", "dot path, e.g. mono.defaultProfile")
    .action(async (key: string) => {
      writeJson(await runConfigGet(key));
    });

  config
    .command("list")
    .description("Print ~/.mono/config.json")
    .action(async () => {
      writeJson(await runConfigList());
    });

  config
    .command("set")
    .description("Set a non-secret value in ~/.mono/config.json")
    .argument("<key>", "dot path")
    .argument("<value>", "JSON or plain string value")
    .action(async (key: string, value: string) => {
      const result = await runConfigSet(key, value);
      writeLine(`Updated ${result.key}`);
    });

  config
    .command("bind-project")
    .description("Bind the current project to a profile")
    .argument("<profile>", "profile name")
    .action(async (profile: string) => {
      await runBindProject(profile);
      writeLine(`Bound ${process.cwd()} to profile ${profile}`);
    });
}
