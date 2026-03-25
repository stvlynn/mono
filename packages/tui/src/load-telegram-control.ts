import { existsSync } from "node:fs";

export async function loadTelegramControlModule(): Promise<typeof import("@mono/telegram-control")> {
  if (existsSync(new URL("../../telegram-control/src/index.ts", import.meta.url))) {
    return import("../../telegram-control/src/index.js") as Promise<typeof import("@mono/telegram-control")>;
  }

  return import("../../telegram-control/dist/index.js") as Promise<typeof import("@mono/telegram-control")>;
}
