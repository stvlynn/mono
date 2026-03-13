import { Command } from "commander";
import { writeLine } from "../output.js";
import { runTelegramPairCommand } from "../use-cases/telegram.js";

function writeCommandResult(result: Awaited<ReturnType<typeof runTelegramPairCommand>>) {
  for (const line of result.lines) {
    writeLine(line);
  }
}

export function registerPairCommand(program: Command): void {
  const pair = program.command("pair").description("Approve Telegram pairing and allowlist entries");
  const telegram = pair.command("telegram").description("Manage Telegram pairing approvals");

  telegram
    .command("code")
    .description("Approve a pending Telegram pairing code")
    .argument("<code>", "pairing code")
    .action(async (code: string) => {
      writeCommandResult(await runTelegramPairCommand(`telegram code ${code}`));
    });

  telegram
    .command("userid")
    .description("Directly allowlist a Telegram user id")
    .argument("<userId>", "Telegram user id")
    .action(async (userId: string) => {
      writeCommandResult(await runTelegramPairCommand(`telegram userid ${userId}`));
    });

  telegram
    .command("botid")
    .description("Persist the Telegram bot id used for diagnostics and self-checks")
    .argument("<botId>", "Telegram bot id")
    .action(async (botId: string) => {
      writeCommandResult(await runTelegramPairCommand(`telegram botid ${botId}`));
    });
}
