import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { type AgentTool, type ToolExecutionResult } from "@mono/shared";
import { z } from "zod";
import { formatBytes, truncateText } from "./utils.js";

const schema = z.object({
  command: z.string(),
  timeout: z.number().positive().optional()
});

type BashInput = z.infer<typeof schema>;

export interface BashToolDetails {
  exitCode: number | null;
  fullOutputPath?: string;
  truncated: boolean;
}

export function createBashTool(cwd: string): AgentTool<BashInput, BashToolDetails> {
  return {
    name: "bash",
    description: "Execute a shell command in the workspace.",
    executionMode: "serial",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeout: { type: "number", description: "Optional timeout in seconds" }
      },
      required: ["command"],
      additionalProperties: false
    },
    parseArgs: (input) => schema.parse(input),
    async execute(args, context): Promise<ToolExecutionResult<BashToolDetails>> {
      const tempFile = join(tmpdir(), `mono-bash-${randomUUID()}.log`);
      const stream = createWriteStream(tempFile);
      let output = "";
      let totalBytes = 0;
      let truncated = false;

      const exitCode = await new Promise<number | null>((resolve, reject) => {
        const child = spawn(process.env.SHELL || "bash", ["-lc", args.command], {
          cwd,
          stdio: ["ignore", "pipe", "pipe"],
          signal: context.signal
        });

        let timeoutId: NodeJS.Timeout | undefined;
        if (args.timeout) {
          timeoutId = setTimeout(() => {
            child.kill("SIGTERM");
          }, args.timeout * 1000);
        }

        const onChunk = (chunk: Buffer) => {
          totalBytes += chunk.length;
          stream.write(chunk);
          output += chunk.toString("utf8");
          if (output.length > 8192) {
            output = output.slice(-8192);
            truncated = true;
          }
          context.onUpdate?.({
            content: truncateText(output)
          });
        };

        child.stdout?.on("data", onChunk);
        child.stderr?.on("data", onChunk);
        child.on("error", reject);
        child.on("close", (code) => {
          if (timeoutId) clearTimeout(timeoutId);
          resolve(code);
        });
      });

      stream.end();
      return {
        content: truncateText(output),
        details: {
          exitCode,
          fullOutputPath: truncated ? tempFile : undefined,
          truncated
        }
      };
    }
  };
}
