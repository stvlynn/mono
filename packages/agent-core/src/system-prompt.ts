import { defaultPromptRenderer, type PromptRenderer } from "@mono/prompts";

export interface SystemPromptSection {
  title: string;
  body: string;
}

export interface SystemPromptInput {
  cwd: string;
  sections?: SystemPromptSection[];
}

export function createDefaultSystemPrompt(
  cwd: string,
  memoryContext?: string,
  taskContext?: string,
  skillsContext?: string,
  renderer?: PromptRenderer
): string;
export function createDefaultSystemPrompt(
  input: SystemPromptInput,
  renderer?: PromptRenderer
): string;
export function createDefaultSystemPrompt(
  inputOrCwd: string | SystemPromptInput,
  memoryContextOrRenderer?: string | PromptRenderer,
  taskContext?: string,
  skillsContext?: string,
  renderer: PromptRenderer = defaultPromptRenderer
): string {
  if (typeof inputOrCwd === "object") {
    return renderSystemPrompt(
      inputOrCwd.cwd,
      inputOrCwd.sections ?? [],
      memoryContextOrRenderer as PromptRenderer | undefined ?? renderer
    );
  }

  const promptRenderer =
    typeof memoryContextOrRenderer === "object"
      ? memoryContextOrRenderer
      : renderer;
  return renderSystemPrompt(
    inputOrCwd,
    buildLegacySections(taskContext, typeof memoryContextOrRenderer === "string" ? memoryContextOrRenderer : undefined, skillsContext),
    promptRenderer
  );
}

function renderSystemPrompt(cwd: string, sections: SystemPromptSection[], renderer: PromptRenderer): string {
  return renderer.render("agent/system_prompt", {
    cwd,
    sections,
    task_context: "",
    memory_context: "",
    skills_context: ""
  });
}

function buildLegacySections(
  taskContext?: string,
  memoryContext?: string,
  skillsContext?: string
): SystemPromptSection[] {
  return [
    taskContext?.trim() ? { title: "Task Context", body: taskContext.trim() } : undefined,
    memoryContext?.trim() ? { title: "Memory Context", body: memoryContext.trim() } : undefined,
    skillsContext?.trim() ? { title: "Skills Context", body: skillsContext.trim() } : undefined
  ].filter((section): section is SystemPromptSection => section !== undefined);
}
