import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { Agent } from "@mono/agent-core";
import type { TaskInput } from "@mono/shared";

export async function promptApproval(): Promise<(reason: { toolName: string; reason: string; input: unknown }) => Promise<boolean>> {
  const rl = createInterface({ input, output });
  return async (request) => {
    const answer = await rl.question(
      `Approve ${request.toolName}? ${request.reason}\n${JSON.stringify(request.input, null, 2)}\n[y/N] `
    );
    return answer.trim().toLowerCase() === "y";
  };
}

export async function runPrint(
  inputText: string | TaskInput,
  options: { model?: string; profile?: string; baseURL?: string; yes?: boolean; continueSession?: boolean }
): Promise<void> {
  const agent = new Agent({
    model: options.model,
    profile: options.profile,
    baseURL: options.baseURL,
    autoApprove: options.yes,
    continueSession: options.continueSession
  });
  if (!options.yes) {
    agent.setRequestApproval(await promptApproval());
  }
  agent.subscribe((event) => {
    if (event.type === "assistant-text-delta") {
      process.stdout.write(event.delta);
    } else if (event.type === "task-phase-change") {
      process.stderr.write(`\n[task] phase=${event.task.phase}\n`);
    } else if (event.type === "task-verify-result") {
      process.stderr.write(`\n[verify] ${event.passed ? "passed" : "failed"} ${event.reason}\n`);
    } else if (event.type === "session-compressed") {
      process.stderr.write(`\n[session] compressed ${event.result.replacedMessageCount} messages\n`);
    } else if (event.type === "tool-start") {
      process.stderr.write(`\n[tool:${event.toolName}] start\n`);
    } else if (event.type === "tool-end") {
      process.stderr.write(`\n[tool:${event.toolName}] ${event.isError ? "error" : "done"}\n`);
    } else if (event.type === "task-summary") {
      process.stderr.write(`\n[task] ${event.result.summary}\n`);
    }
  });
  await agent.runTask(inputText);
  process.stdout.write("\n");
}
