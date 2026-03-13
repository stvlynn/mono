import { Command } from "commander";
import { writeLine } from "../output.js";
import { runTelegramCommand, runTelegramStatus } from "../use-cases/telegram.js";

function writeCommandResult(result: Awaited<ReturnType<typeof runTelegramCommand>>) {
  for (const line of result.lines) {
    writeLine(line);
  }
}

export function registerTelegramCommand(program: Command): void {
  const telegram = program.command("telegram").description("Configure and inspect Telegram control runtime");

  telegram
    .command("status")
    .description("Show Telegram control runtime status")
    .action(async () => {
      const result = await runTelegramStatus();
      for (const line of result.lines) {
        writeLine(line);
      }
    });

  telegram
    .command("token")
    .description("Save the Telegram bot token and enable Telegram control")
    .argument("<botToken>", "Telegram Bot API token")
    .action(async (botToken: string) => {
      writeCommandResult(await runTelegramCommand(`token ${botToken}`));
    });

  telegram
    .command("enable")
    .description("Enable Telegram control runtime")
    .action(async () => {
      writeCommandResult(await runTelegramCommand("enable"));
    });

  telegram
    .command("disable")
    .description("Disable Telegram control runtime")
    .action(async () => {
      writeCommandResult(await runTelegramCommand("disable"));
    });
}
