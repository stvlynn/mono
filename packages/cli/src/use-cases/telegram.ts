import {
  buildTelegramStatusResult,
  executePairCommand,
  executeTelegramCommand,
} from "@mono/telegram-control";

export async function runTelegramPairCommand(argsText: string) {
  return executePairCommand(argsText, process.cwd());
}

export async function runTelegramCommand(argsText: string) {
  return executeTelegramCommand(argsText, process.cwd());
}

export async function runTelegramStatus() {
  return buildTelegramStatusResult(process.cwd());
}
