export type PromptTemplateId =
  | "agent/system_prompt"
  | "memory/context_block"
  | "memory/trace_user"
  | "memory/trace_assistant"
  | "memory/trace_tool_call"
  | "memory/trace_tool_result"
  | "memory/compacted_step_received"
  | "memory/compacted_step_tool_call"
  | "memory/compacted_step_tool_result"
  | "memory/compacted_step_assistant"
  | "memory/compacted_step_user_response";

export interface PromptRenderOptions {
  trimBlocks?: boolean;
  lstripBlocks?: boolean;
  throwOnUndefined?: boolean;
}

export interface TemplateRegistry {
  getPath(templateId: PromptTemplateId): string;
  exists(templateId: PromptTemplateId): boolean;
  list(): PromptTemplateId[];
}

export interface PromptRenderer {
  render(templateId: PromptTemplateId, context?: Record<string, unknown>): string;
}
