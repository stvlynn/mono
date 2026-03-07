import { readFile } from "node:fs/promises";
import { resolveWithin, type AgentTool, type ToolExecutionResult } from "@mono/shared";
import { z } from "zod";
import { formatBytes, isImagePath, truncateText } from "./utils.js";

const schema = z.object({
  path: z.string(),
  offset: z.number().int().positive().optional(),
  limit: z.number().int().positive().optional()
});

type ReadInput = z.infer<typeof schema>;

export function createReadTool(cwd: string): AgentTool<ReadInput> {
  return {
    name: "read",
    description: "Read a file from the workspace. Supports text files and common image formats.",
    executionMode: "parallel_readonly",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path to the file to read" },
        offset: { type: "number", description: "1-indexed starting line for text files" },
        limit: { type: "number", description: "Maximum number of lines to read" }
      },
      required: ["path"],
      additionalProperties: false
    },
    parseArgs: (input) => schema.parse(input),
    conflictKey: (args) =>
      `path=${resolveWithin(cwd, args.path)};offset=${args.offset ?? 1};limit=${args.limit ?? "all"}`,
    async execute(args): Promise<ToolExecutionResult> {
      const filePath = resolveWithin(cwd, args.path);
      const buffer = await readFile(filePath);
      if (isImagePath(filePath)) {
        return {
          content: [
            { type: "text", text: `Read image ${args.path} (${formatBytes(buffer.length)})` },
            { type: "image", mimeType: guessMimeType(filePath), data: buffer.toString("base64") }
          ]
        };
      }

      const raw = buffer.toString("utf8");
      const lines = raw.split("\n");
      const start = Math.max(0, (args.offset ?? 1) - 1);
      const end = args.limit ? Math.min(lines.length, start + args.limit) : lines.length;
      const snippet = truncateText(lines.slice(start, end).join("\n"));
      return {
        content: `${snippet}\n\n[read ${args.path}]`
      };
    }
  };
}

function guessMimeType(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}
