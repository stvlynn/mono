import { existsSync } from "node:fs";

export async function loadPromptsModule(): Promise<typeof import("@mono/prompts")> {
  if (existsSync(new URL("../../prompts/src/index.ts", import.meta.url))) {
    return import("../../prompts/src/index.js") as Promise<typeof import("@mono/prompts")>;
  }

  return import("../../prompts/dist/index.js") as Promise<typeof import("@mono/prompts")>;
}
