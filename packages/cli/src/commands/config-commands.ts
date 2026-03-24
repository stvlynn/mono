import { stdout as output } from "node:process";
import { Command } from "commander";
import { runConfigUi } from "../use-cases/config-ui.js";
import { runBindProject, runConfigGet, runConfigInit, runConfigList, runConfigMigrate, runConfigSet } from "../use-cases/config.js";
import { writeJson, writeLine } from "../output.js";

export function registerConfigCommands(program: Command): void {
  const config = program.command("config").description("Manage ~/.mono configuration");

  config
    .command("ui")
    .description("Serve the browser-based configuration UI")
    .option("--host <host>", "bind host", "127.0.0.1")
    .option("--port <port>", "bind port", "5173")
    .option("--api-only", "serve JSON API without static assets")
    .option("--no-open", "do not open the browser automatically")
    .action(async (options) => {
      const result = await runConfigUi({
        host: options.host,
        port: Number(options.port),
        apiOnly: Boolean(options.apiOnly),
        openBrowser: Boolean(options.open),
      });
      writeLine(`Config UI available at ${result.url}`);
    });

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
