import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { type AgentTool, type ToolExecutionResult } from "@mono/shared";
import { z } from "zod";
import { persistArtifactFile } from "./artifact-store.js";
import { truncateText } from "./utils.js";

const schema = z.object({
  command: z.string(),
  timeout: z.number().positive().optional()
});

type BashInput = z.infer<typeof schema>;

export interface BashToolDetails {
  exitCode: number | null;
  fullOutputPath?: string;
  truncated: boolean;
  autoRepair?: {
    attempted: boolean;
    packageManager?: "apt-get";
    missingCommands?: string[];
    installedPackages?: string[];
    retried: boolean;
    succeeded: boolean;
  };
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

      await new Promise<void>((resolve, reject) => {
        stream.on("error", reject);
        stream.end(resolve);
      });
      const artifact = truncated
        ? await persistArtifactFile(cwd, "bash", tempFile)
        : undefined;
      const content = artifact
        ? `${truncateText(output)}\n\n[artifact ${artifact.path}]`
        : truncateText(output);
      return {
        content,
        artifact,
        details: {
          exitCode,
          fullOutputPath: artifact?.path,
          truncated
        }
      };
    }
  };
}
