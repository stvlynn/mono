import type { AgentTool, ConversationMessage, RuntimeEvent, ThinkingLevel, UnifiedModel } from "@mono/shared";

export interface LlmRunOptions {
  model: UnifiedModel;
  systemPrompt: string;
  messages: ConversationMessage[];
  tools: AgentTool[];
  thinkingLevel: ThinkingLevel;
  maxSteps: number;
  emit: (event: RuntimeEvent) => void;
  signal?: AbortSignal;
}

export interface LlmTextStreamOptions {
  model: UnifiedModel;
  systemPrompt: string;
  messages: ConversationMessage[];
  thinkingLevel: ThinkingLevel;
  onTextDelta?: (delta: string) => void;
  onThinkingDelta?: (delta: string) => void;
  signal?: AbortSignal;
}

export interface ModelAdapter {
  id: string;
  supports(model: UnifiedModel): boolean;
  run(options: LlmRunOptions): Promise<ConversationMessage[]>;
  streamText(options: LlmTextStreamOptions): Promise<string>;
}
