import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { PromptTemplateId, TemplateRegistry } from "./types.js";

export const TEMPLATE_FILES: Record<PromptTemplateId, string> = {
  "agent/system_prompt": "agent/system_prompt.j2",
  "ui/waiting_assistant_start": "ui/waiting_assistant_start.j2",
  "ui/waiting_assistant_reasoning": "ui/waiting_assistant_reasoning.j2",
  "ui/waiting_assistant_streaming": "ui/waiting_assistant_streaming.j2",
  "ui/waiting_tool_running": "ui/waiting_tool_running.j2",
  "ui/waiting_task_planning": "ui/waiting_task_planning.j2",
  "ui/waiting_task_verifying": "ui/waiting_task_verifying.j2",
  "memory/context_block": "memory/context_block.j2",
  "memory/structured_context_block": "memory/structured_context_block.j2",
  "memory/openviking_context_block": "memory/openviking_context_block.j2",
  "memory/seekdb_context_block": "memory/seekdb_context_block.j2",
  "memory/trace_user": "memory/trace_user.j2",
  "memory/trace_assistant": "memory/trace_assistant.j2",
  "memory/trace_tool_call": "memory/trace_tool_call.j2",
  "memory/trace_tool_result": "memory/trace_tool_result.j2",
  "memory/compacted_step_received": "memory/compacted_step_received.j2",
  "memory/compacted_step_tool_call": "memory/compacted_step_tool_call.j2",
  "memory/compacted_step_tool_result": "memory/compacted_step_tool_result.j2",
  "memory/compacted_step_assistant": "memory/compacted_step_assistant.j2",
  "memory/compacted_step_user_response": "memory/compacted_step_user_response.j2"
};

export function getTemplatesRoot(): string {
  return fileURLToPath(new URL("./templates", import.meta.url));
}

export class FileTemplateRegistry implements TemplateRegistry {
  private readonly templatesRoot = getTemplatesRoot();

  getPath(templateId: PromptTemplateId): string {
    const relative = TEMPLATE_FILES[templateId];
    if (!relative) {
      throw new Error(`Unknown prompt template: ${templateId}`);
    }
    return join(this.templatesRoot, relative);
  }

  exists(templateId: PromptTemplateId): boolean {
    return existsSync(this.getPath(templateId));
  }

  list(): PromptTemplateId[] {
    return Object.keys(TEMPLATE_FILES) as PromptTemplateId[];
  }
}
