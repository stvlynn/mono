import { defaultPromptRenderer, type PromptRenderer } from "@mono/prompts";

export function createDefaultSystemPrompt(
  cwd: string,
  memoryContext?: string,
  taskContext?: string,
  renderer: PromptRenderer = defaultPromptRenderer
): string {
  return renderer.render("agent/system_prompt", {
    cwd,
    task_context: taskContext ?? "",
    memory_context: memoryContext ?? ""
  });
}
