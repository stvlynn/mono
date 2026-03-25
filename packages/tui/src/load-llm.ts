import { existsSync } from "node:fs";

export async function loadLlmModule(): Promise<typeof import("@mono/llm")> {
  if (existsSync(new URL("../../llm/src/index.ts", import.meta.url))) {
    return import("../../llm/src/index.js") as Promise<typeof import("@mono/llm")>;
  }

  return import("../../llm/dist/index.js") as Promise<typeof import("@mono/llm")>;
}
