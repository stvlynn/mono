import { writeFile } from "node:fs/promises";
import { ensureParentDir, resolveWithin, type AgentTool } from "@mono/shared";
import { z } from "zod";

const schema = z.object({
  path: z.string(),
  content: z.string()
});

type WriteInput = z.infer<typeof schema>;

export function createWriteTool(cwd: string): AgentTool<WriteInput> {
  return {
    name: "write",
    description: "Create or overwrite a file in the workspace.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path to the file to write" },
        content: { type: "string", description: "Full file content" }
      },
      required: ["path", "content"],
      additionalProperties: false
    },
    parseArgs: (input) => schema.parse(input),
    async execute(args) {
      const filePath = resolveWithin(cwd, args.path);
      await ensureParentDir(filePath);
      await writeFile(filePath, args.content, "utf8");
      return {
        content: `Wrote ${args.content.length} bytes to ${args.path}`
      };
    }
  };
}
