import { Command } from "commander";
import { Agent } from "@mono/agent-core";
import { readInputImageAttachmentFromPath } from "@mono/shared";
import { runPrint } from "../print-runtime.js";

export function registerRootCommand(program: Command): void {
  program
    .name("mono")
    .description("AI SDK-powered coding agent CLI")
    .argument("[prompt...]", "initial prompt")
    .option("-p, --print", "run once and exit")
    .option("-m, --model <model>", "provider/model or raw model id")
    .option("--profile <profile>", "configured profile name from ~/.mono/config.json")
    .option("--base-url <baseUrl>", "override provider base URL")
    .option("-i, --image <path>", "attach a local image", (value: string, previous: string[] = []) => [...previous, value], [])
    .option("-y, --yes", "auto-approve protected tools")
    .option("-c, --continue", "load previous session from the current workspace")
    .action(async (promptParts: string[], options) => {
      const promptText = promptParts.join(" ").trim();
      const attachments = await Promise.all(
        (options.image as string[]).map((path) =>
          readInputImageAttachmentFromPath(path, {
            cwd: process.cwd(),
            origin: "local_cli"
          }),
        ),
      );
      if (options.print) {
        if (!promptText && attachments.length === 0) {
          throw new Error("Print mode requires a prompt or at least one image");
        }
        await runPrint({ text: promptText || undefined, attachments }, {
          model: options.model,
          profile: options.profile,
          baseURL: options.baseUrl,
          yes: options.yes,
          continueSession: options.continue
        });
        return;
      }

      const agent = new Agent({
        model: options.model,
        profile: options.profile,
        baseURL: options.baseUrl,
        autoApprove: options.yes,
        continueSession: options.continue
      });
      const { runInteractiveApp } = await import("@mono/tui");
      await runInteractiveApp({
        agent,
        initialPrompt: promptText || undefined,
        initialAttachments: attachments.length > 0 ? attachments : undefined
      });
    });
}
