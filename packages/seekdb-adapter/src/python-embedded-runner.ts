import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SeekDbRunner } from "./types.js";
import { runProcess } from "./process.js";

interface PythonBridgeResponse {
  ok: boolean;
  rows?: unknown[];
  error?: string;
}

function resolveBridgeScript(): string {
  const distCandidate = fileURLToPath(new URL("./scripts/embedded_bridge.py", import.meta.url));
  if (existsSync(distCandidate)) {
    return distCandidate;
  }
  return fileURLToPath(new URL("../scripts/embedded_bridge.py", import.meta.url));
}

export class SeekDbPythonEmbeddedRunner implements SeekDbRunner {
  private readonly bridgeScriptPath = resolveBridgeScript();

  constructor(
    private readonly config: {
      pythonExecutable: string;
      pythonModule: string;
      embeddedPath?: string;
      timeoutMs?: number;
    }
  ) {
    if (!config.embeddedPath) {
      throw new Error("SeekDB python-embedded mode requires seekDb.embeddedPath to be configured");
    }
  }

  async health(): Promise<unknown> {
    await this.queryRows("SELECT 'ok' AS payload");
    return {
      ok: true,
      mode: "python-embedded",
      embeddedPath: this.config.embeddedPath
    };
  }

  async execute(statements: string[]): Promise<void> {
    await this.invoke({
      statements
    });
  }

  async queryRows(sql: string): Promise<string[]> {
    const response = await this.invoke({
      query: sql
    });
    return (response.rows ?? []).map((row) => String(row));
  }

  private async invoke(payload: { statements?: string[]; query?: string }): Promise<PythonBridgeResponse> {
    const { stdout } = await runProcess({
      command: this.config.pythonExecutable,
      args: [this.bridgeScriptPath],
      input: JSON.stringify({
        pythonModule: this.config.pythonModule,
        embeddedPath: this.config.embeddedPath,
        ...payload
      }),
      timeoutMs: this.config.timeoutMs
    });
    const response = JSON.parse(stdout) as PythonBridgeResponse;
    if (!response.ok) {
      throw new Error(response.error ?? "SeekDB embedded bridge returned an error");
    }
    return response;
  }
}
