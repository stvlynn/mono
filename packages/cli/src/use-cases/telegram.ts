import { existsSync } from "node:fs";

async function loadTelegramControlModule(): Promise<typeof import("@mono/telegram-control")> {
  if (existsSync(new URL("../../../telegram-control/src/index.ts", import.meta.url))) {
    return import("../../../telegram-control/src/index.js") as Promise<typeof import("@mono/telegram-control")>;
  }

  return import("../../../telegram-control/dist/index.js") as Promise<typeof import("@mono/telegram-control")>;
}

export async function runTelegramPairCommand(argsText: string) {
  const { executePairCommand } = await loadTelegramControlModule();
  return executePairCommand(argsText, process.cwd());
}

export async function runTelegramCommand(argsText: string) {
  const { executeTelegramCommand } = await loadTelegramControlModule();
  return executeTelegramCommand(argsText, process.cwd());
}

export async function runTelegramStatus() {
  const { buildTelegramStatusResult } = await loadTelegramControlModule();
  return buildTelegramStatusResult(process.cwd());
}
