import { readFile, writeFile } from "node:fs/promises";
import { createTwoFilesPatch } from "diff";
import { resolveWithin, type AgentTool } from "@mono/shared";
import { z } from "zod";

const schema = z.object({
  path: z.string(),
  oldText: z.string(),
  newText: z.string()
});

type EditInput = z.infer<typeof schema>;

export function createEditTool(cwd: string): AgentTool<EditInput, { diff: string }> {
  return {
    name: "edit",
    description: "Replace an exact text block in a file.",
    executionMode: "serial",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        oldText: { type: "string" },
        newText: { type: "string" }
      },
      required: ["path", "oldText", "newText"],
      additionalProperties: false
    },
    parseArgs: (input) => schema.parse(input),
    async execute(args) {
      const filePath = resolveWithin(cwd, args.path);
      const before = await readFile(filePath, "utf8");
      const matches = before.split(args.oldText).length - 1;
      if (matches === 0) {
        throw new Error(`Could not find target text in ${args.path}`);
      }
      if (matches > 1) {
        throw new Error(`Target text appears ${matches} times in ${args.path}`);
      }
      const after = before.replace(args.oldText, args.newText);
      await writeFile(filePath, after, "utf8");
      const diff = createTwoFilesPatch(args.path, args.path, before, after, "before", "after");
      return {
        content: `Edited ${args.path}`,
        details: { diff }
      };
    }
  };
}
