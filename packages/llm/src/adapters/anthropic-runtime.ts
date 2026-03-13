import type {
  AssistantMessage,
  ConversationMessage,
  ToolCallPart,
  ToolResultMessage,
  ToolResultPart
} from "@mono/shared";
import type { LlmRunOptions } from "./types.js";
import { ToolBatchScheduler } from "./tool-batch-scheduler.js";
import { mapAnthropicThinking } from "./xsai-shared.js";

type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; tool_use_id: string; is_error?: boolean; content: string | AnthropicContentBlock[] };

interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicContentBlock[];
}

interface PendingTextBlock {
  type: "text";
  text: string;
}

interface PendingThinkingBlock {
  type: "thinking";
  thinking: string;
}

interface PendingToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input?: Record<string, unknown>;
  inputJson: string;
}

type PendingBlock = PendingTextBlock | PendingThinkingBlock | PendingToolUseBlock;

interface ToolResultRecord {
  toolName: string;
  input: unknown;
  inputSignature: string;
  content: string | ToolResultPart[];
  isError: boolean;
}

function resolveApiKey(options: LlmRunOptions): string {
  const apiKey = options.model.apiKey ?? (options.model.apiKeyEnv ? process.env[options.model.apiKeyEnv] : undefined);
  if (!apiKey) {
    throw new Error(`Missing API key for provider ${options.model.provider}`);
  }
  return apiKey;
}

function resolveAnthropicEndpoint(baseURL: string): string {
  const trimmed = baseURL.trim().replace(/\/+$/u, "");
  if (trimmed.endsWith("/messages")) {
    return trimmed;
  }
  return `${trimmed}/messages`;
}

function resolveAnthropicMaxTokens(level: LlmRunOptions["thinkingLevel"]): number {
  const thinking = mapAnthropicThinking(level);
  if (!thinking) {
    return 4_096;
  }
  return Math.max(4_096, thinking.budget_tokens + 1_024);
}

function mapAnthropicStopReason(stopReason: string | null | undefined): AssistantMessage["stopReason"] {
  if (stopReason === "tool_use") {
    return "tool_use";
  }
  if (stopReason === "max_tokens") {
    return "length";
  }
  if (stopReason === "error") {
    return "error";
  }
  return "stop";
}

function toAnthropicContent(parts: ToolResultPart[]): AnthropicContentBlock[] {
  return parts.map((part) => {
    if (part.type === "text") {
      return { type: "text", text: part.text };
    }

    return {
      type: "image",
      source: {
        type: "base64",
        media_type: part.mimeType,
        data: part.data
      }
    };
  });
}

function toAnthropicToolResultContent(content: string | ToolResultPart[]): string | AnthropicContentBlock[] {
  return typeof content === "string" ? content : toAnthropicContent(content);
}

function isToolResultBlock(
  block: AnthropicContentBlock
): block is Extract<AnthropicContentBlock, { type: "tool_result" }> {
  return block.type === "tool_result";
}

function appendAnthropicMessage(output: AnthropicMessage[], next: AnthropicMessage): void {
  if (next.content.length === 0) {
    return;
  }

  const previous = output.at(-1);
  const isToolResultOnly = next.role === "user" && next.content.every(isToolResultBlock);
  if (previous && isToolResultOnly && previous.role === "user" && previous.content.every(isToolResultBlock)) {
    previous.content.push(...next.content.filter(isToolResultBlock));
    return;
  }

  output.push(next);
}

function toAnthropicMessages(messages: ConversationMessage[]): AnthropicMessage[] {
  const output: AnthropicMessage[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      const content = typeof message.content === "string"
        ? [{ type: "text", text: message.content } satisfies AnthropicContentBlock]
        : message.content.map<AnthropicContentBlock>((part) =>
            part.type === "text"
              ? { type: "text", text: part.text }
              : {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: part.mimeType,
                    data: part.data
                  }
                }
          );
      appendAnthropicMessage(output, { role: "user", content });
      continue;
    }

    if (message.role === "tool") {
      appendAnthropicMessage(output, {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: message.toolCallId,
            is_error: message.isError || undefined,
            content: toAnthropicToolResultContent(message.content)
          }
        ]
      });
      continue;
    }

    const content: AnthropicContentBlock[] = [];
    for (const part of message.content) {
      if (part.type === "text") {
        content.push({ type: "text", text: part.text });
      } else if (part.type === "tool-call") {
        content.push({
          type: "tool_use",
          id: part.id,
          name: part.name,
          input: part.arguments
        });
      }
    }

    // Anthropic requires signed thinking blocks for replay, which we do not persist.
    appendAnthropicMessage(output, { role: "assistant", content });
  }

  return output;
}

function buildAnthropicTools(options: LlmRunOptions): {
  scheduler: ToolBatchScheduler;
  toolResultMap: Map<string, ToolResultRecord>;
} {
  const toolResultMap = new Map<string, ToolResultRecord>();
  const scheduler = new ToolBatchScheduler({
    llmOptions: options,
    toolResultMap,
    toXsaiContent: toAnthropicContent
  });

  return { scheduler, toolResultMap };
}

function parseSseEvent(rawEvent: string): { event: string; data: string } {
  let event = "message";
  const dataLines: string[] = [];

  for (const line of rawEvent.replace(/\r/gu, "").split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }

  return {
    event,
    data: dataLines.join("\n")
  };
}

async function consumeAnthropicStream(
  response: Response,
  onEvent: (eventName: string, payload: Record<string, unknown>) => void
): Promise<void> {
  if (!response.ok) {
    throw new Error(`Remote sent ${response.status} response: ${await response.text()}`);
  }
  if (!response.body) {
    throw new Error("Response body is empty from remote server");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const boundary = buffer.indexOf("\n\n");
      if (boundary === -1) {
        break;
      }

      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      if (!rawEvent.trim()) {
        continue;
      }

      const parsed = parseSseEvent(rawEvent);
      if (!parsed.data) {
        continue;
      }

      const payload = JSON.parse(parsed.data) as Record<string, unknown>;
      onEvent(parsed.event, payload);
    }
  }

  const finalChunk = buffer.trim();
  if (!finalChunk) {
    return;
  }

  const parsed = parseSseEvent(finalChunk);
  if (!parsed.data) {
    return;
  }
  onEvent(parsed.event, JSON.parse(parsed.data) as Record<string, unknown>);
}

function createPendingToolUseBlock(payload: Record<string, unknown>): PendingToolUseBlock {
  const id = typeof payload.id === "string" ? payload.id : "tool-call";
  const name = typeof payload.name === "string" ? payload.name : "unknown";
  const input = payload.input && typeof payload.input === "object"
    ? payload.input as Record<string, unknown>
    : undefined;
  const hasInitialInput = input && Object.keys(input).length > 0;

  return {
    type: "tool_use",
    id,
    name,
    input,
    inputJson: hasInitialInput ? JSON.stringify(input) : ""
  };
}

function parseToolArguments(block: PendingToolUseBlock): Record<string, unknown> {
  if (block.inputJson.trim()) {
    return JSON.parse(block.inputJson) as Record<string, unknown>;
  }
  return block.input ?? {};
}

async function runAnthropicStep(
  options: LlmRunOptions,
  messages: ConversationMessage[]
): Promise<AssistantMessage> {
  const endpoint = resolveAnthropicEndpoint(options.model.baseURL);
  const apiKey = resolveApiKey(options);
  const blocks: PendingBlock[] = [];
  let stopReason: AssistantMessage["stopReason"] = "stop";

  const thinking = mapAnthropicThinking(options.thinkingLevel);
  const body = {
    model: options.model.modelId,
    system: options.systemPrompt,
    messages: toAnthropicMessages(messages),
    max_tokens: resolveAnthropicMaxTokens(options.thinkingLevel),
    stream: true,
    ...(thinking ? { thinking } : {}),
    ...(options.tools.length > 0
      ? {
          tools: options.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.inputSchema
          }))
        }
      : {})
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": apiKey
    },
    body: JSON.stringify(body),
    signal: options.signal
  });

  await consumeAnthropicStream(response, (eventName, payload) => {
    if (eventName === "error") {
      const error = payload.error;
      const message = error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string"
        ? (error as { message: string }).message
        : JSON.stringify(payload);
      throw new Error(message);
    }

    if (eventName === "content_block_start") {
      const index = typeof payload.index === "number" ? payload.index : 0;
      const contentBlock = payload.content_block;
      if (!contentBlock || typeof contentBlock !== "object") {
        return;
      }

      const typedBlock = contentBlock as Record<string, unknown>;
      if (typedBlock.type === "text") {
        blocks[index] = {
          type: "text",
          text: typeof typedBlock.text === "string" ? typedBlock.text : ""
        };
        return;
      }

      if (typedBlock.type === "thinking") {
        blocks[index] = {
          type: "thinking",
          thinking: typeof typedBlock.thinking === "string" ? typedBlock.thinking : ""
        };
        return;
      }

      if (typedBlock.type === "tool_use") {
        const toolUse = createPendingToolUseBlock(typedBlock);
        blocks[index] = toolUse;
        options.emit({
          type: "assistant-tool-call",
          toolCallId: toolUse.id,
          toolName: toolUse.name
        });
      }
      return;
    }

    if (eventName === "content_block_delta") {
      const index = typeof payload.index === "number" ? payload.index : 0;
      const delta = payload.delta;
      if (!delta || typeof delta !== "object") {
        return;
      }

      const typedDelta = delta as Record<string, unknown>;
      const block = blocks[index];
      if (!block) {
        return;
      }

      if (typedDelta.type === "text_delta" && block.type === "text") {
        const text = typeof typedDelta.text === "string" ? typedDelta.text : "";
        block.text += text;
        if (text) {
          options.emit({ type: "assistant-text-delta", delta: text });
        }
        return;
      }

      if (typedDelta.type === "thinking_delta" && block.type === "thinking") {
        const thinkingText = typeof typedDelta.thinking === "string" ? typedDelta.thinking : "";
        block.thinking += thinkingText;
        if (thinkingText) {
          options.emit({ type: "assistant-thinking-delta", delta: thinkingText });
        }
        return;
      }

      if (typedDelta.type === "input_json_delta" && block.type === "tool_use") {
        const partialJson = typeof typedDelta.partial_json === "string" ? typedDelta.partial_json : "";
        block.inputJson += partialJson;
        if (partialJson) {
          options.emit({
            type: "assistant-tool-call",
            toolCallId: block.id,
            toolName: block.name,
            argsText: partialJson
          });
        }
      }
      return;
    }

    if (eventName === "message_delta") {
      const delta = payload.delta;
      if (!delta || typeof delta !== "object") {
        return;
      }
      stopReason = mapAnthropicStopReason((delta as { stop_reason?: string | null }).stop_reason);
    }
  });

  const content: AssistantMessage["content"] = [];
  for (const block of blocks) {
    if (!block) {
      continue;
    }
    if (block.type === "text") {
      if (block.text) {
        content.push({ type: "text", text: block.text });
      }
      continue;
    }
    if (block.type === "thinking") {
      if (block.thinking) {
        content.push({ type: "thinking", thinking: block.thinking });
      }
      continue;
    }
    content.push({
      type: "tool-call",
      id: block.id,
      name: block.name,
      arguments: parseToolArguments(block)
    } satisfies ToolCallPart);
  }

  return {
    role: "assistant",
    content,
    provider: options.model.provider,
    model: options.model.modelId,
    stopReason,
    timestamp: Date.now()
  };
}

async function executeAnthropicToolCalls(
  options: LlmRunOptions,
  toolCalls: ToolCallPart[],
  scheduler: ToolBatchScheduler,
  toolResultMap: Map<string, ToolResultRecord>
): Promise<ToolResultMessage[]> {
  await Promise.all(toolCalls.map(async (toolCall) => {
    const tool = options.tools.find((candidate) => candidate.name === toolCall.name);
    if (!tool) {
      throw new Error(`Model tried to call unavailable tool "${toolCall.name}"`);
    }
    await scheduler.schedule(tool, toolCall.arguments, toolCall.id);
  }));

  return toolCalls.map((toolCall) => {
    const stored = toolResultMap.get(toolCall.id);
    if (!stored) {
      throw new Error(`Missing tool result for ${toolCall.name} (${toolCall.id})`);
    }
    return {
      role: "tool",
      toolCallId: toolCall.id,
      toolName: stored.toolName,
      input: stored.input,
      inputSignature: stored.inputSignature,
      content: stored.content,
      isError: stored.isError,
      timestamp: Date.now()
    } satisfies ToolResultMessage;
  });
}

export async function runAnthropicMessagesConversation(options: LlmRunOptions): Promise<ConversationMessage[]> {
  const output: ConversationMessage[] = [];
  const conversation = [...options.messages];
  const { scheduler, toolResultMap } = buildAnthropicTools(options);

  for (let step = 0; step < options.maxSteps; step += 1) {
    const assistantMessage = await runAnthropicStep(options, conversation);
    output.push(assistantMessage);
    conversation.push(assistantMessage);

    const toolCalls = assistantMessage.content.filter((part): part is ToolCallPart => part.type === "tool-call");
    if (toolCalls.length === 0) {
      break;
    }

    const toolMessages = await executeAnthropicToolCalls(options, toolCalls, scheduler, toolResultMap);
    output.push(...toolMessages);
    conversation.push(...toolMessages);
  }

  return output;
}
