import { Command } from "commander";
import { formatContextReportLines } from "@mono/agent-core";
import { writeJson, writeLine } from "../output.js";
import { runContextInspect } from "../use-cases/context.js";

export function registerContextCommand(program: Command): void {
  const context = program.command("context").description("Inspect prompt context assembly");

  context
    .command("list")
    .description("Show a summary of the current prompt context")
    .argument("[prompt...]", "optional prompt to preview context for")
    .option("--json", "output JSON")
    .action(async (promptParts: string[], options) => {
      const prompt = promptParts.join(" ").trim() || undefined;
      const result = await runContextInspect(prompt);
      if (options.json) {
        writeJson(result.report);
        return;
      }
      for (const line of formatContextReportLines(result.report, false)) {
        writeLine(line);
      }
    });

  context
    .command("detail")
    .description("Show detailed prompt context information")
    .argument("[prompt...]", "optional prompt to preview context for")
    .option("--json", "output JSON")
    .action(async (promptParts: string[], options) => {
      const prompt = promptParts.join(" ").trim() || undefined;
      const result = await runContextInspect(prompt);
      if (options.json) {
        writeJson(result);
        return;
      }
      for (const line of formatContextReportLines(result.report, true)) {
        writeLine(line);
      }
    });
}
