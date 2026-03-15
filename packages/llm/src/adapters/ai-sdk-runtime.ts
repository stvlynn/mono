import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  jsonSchema,
  NoOutputGeneratedError,
  stepCountIs,
  streamText,
  type JSONValue,
  type ModelMessage,
  type StepResult,
  type Tool as AiTool,
  type ToolCallOptions,
  tool
} from "ai";
import type {
  AssistantMessage,
  AssistantPart,
  ConversationMessage,
  ToolCallPart,
  ToolResultMessage,
  ToolResultPart,
  UnifiedModel,
  UserMessage,
  UserPart
} from "@mono/shared";
import { ToolBatchScheduler, type StoredToolResult } from "./tool-batch-scheduler.js";
import type { LlmRunOptions } from "./types.js";
import { resolveModelTransport } from "./transport.js";

type ModelToolOutput =
  | { type: "text"; value: string }
  | { type: "json"; value: JSONValue }
  | {
      type: "content";
      value: Array<
        | { type: "text"; text: string }
        | { type: "media"; data: string; mediaType: string }
      >;
    };

function resolveApiKey(model: UnifiedModel): string {
  const apiKey = model.apiKey ?? (model.apiKeyEnv ? process.env[model.apiKeyEnv] : undefined);
  if (!apiKey) {
    throw new Error(`Missing API key for provider ${model.provider}`);
  }
  return apiKey;
}

function mapStopReason(finishReason: string): AssistantMessage["stopReason"] {
  if (finishReason === "tool-calls") {
    return "tool_use";
  }

  if (finishReason === "length") {
    return "length";
  }

  if (finishReason === "error") {
    return "error";
  }

  return "stop";
}

function mapOpenAIReasoningEffort(level: LlmRunOptions["thinkingLevel"]): "low" | "medium" | "high" | undefined {
  if (level === "off") {
    return undefined;
  }

  if (level === "minimal" || level === "low") {
    return "low";
  }

  if (level === "high" || level === "xhigh") {
    return "high";
  }

  return "medium";
}

function mapAnthropicThinking(level: LlmRunOptions["thinkingLevel"]): { type: "enabled"; budgetTokens: number } | undefined {
  if (level === "off") {
    return undefined;
  }

  const budgetByLevel = {
    minimal: 1024,
    low: 2048,
    medium: 4096,
    high: 8192,
    xhigh: 8192
  } satisfies Record<Exclude<LlmRunOptions["thinkingLevel"], "off">, number>;

  return {
    type: "enabled",
    budgetTokens: budgetByLevel[level === "xhigh" ? "high" : level]
  };
}

function mapGoogleThinking(level: LlmRunOptions["thinkingLevel"]): { thinkingBudget: number; includeThoughts: true } | undefined {
  const thinking = mapAnthropicThinking(level);
  if (!thinking) {
    return undefined;
  }

  return {
    thinkingBudget: thinking.budgetTokens,
    includeThoughts: true
  };
}

function createProviderOptions(
  model: UnifiedModel,
  thinkingLevel: LlmRunOptions["thinkingLevel"]
): Record<string, Record<string, JSONValue>> | undefined {
  if (!model.supportsReasoning) {
    return undefined;
  }

  const transport = resolveModelTransport(model);

  if (transport === "anthropic") {
    const thinking = mapAnthropicThinking(thinkingLevel);
    return thinking ? { anthropic: { thinking } } : undefined;
  }

  if (transport === "gemini") {
    const thinkingConfig = mapGoogleThinking(thinkingLevel);
    return thinkingConfig ? { google: { thinkingConfig } } : undefined;
  }

  const reasoningEffort = mapOpenAIReasoningEffort(thinkingLevel);
  if (!reasoningEffort) {
    return undefined;
  }

  const providerName = model.providerFactory === "openai" || model.provider === "openai"
    ? "openai"
    : model.provider;

  return {
    [providerName]: {
      reasoningEffort
    }
  };
}

function createLanguageModel(model: UnifiedModel): unknown {
  const apiKey = resolveApiKey(model);
  const transport = resolveModelTransport(model);

  if (transport === "anthropic") {
    return createAnthropic({
      apiKey,
      baseURL: model.baseURL
    }).languageModel(model.modelId);
  }

  if (transport === "gemini") {
    return createGoogleGenerativeAI({
      apiKey,
      baseURL: model.baseURL
    }).languageModel(model.modelId);
  }

  if (model.providerFactory === "openai" || model.provider === "openai") {
    return createOpenAI({
      apiKey,
      baseURL: model.baseURL
    }).chat(model.modelId);
  }

  return createOpenAICompatible({
    name: model.provider,
    apiKey,
    baseURL: model.baseURL
  }).chatModel(model.modelId);
}

function toModelUserPart(part: UserPart): { type: "text"; text: string } | { type: "image"; image: string; mediaType: string } {
  if (part.type === "text") {
    return { type: "text", text: part.text };
  }

  return {
    type: "image",
    image: part.data,
    mediaType: part.mimeType
  };
}

function toModelUserMessage(message: UserMessage): ModelMessage {
  return {
    role: "user",
    content: typeof message.content === "string" ? message.content : message.content.map(toModelUserPart)
  };
}

function toModelAssistantPart(
  part: AssistantPart
): { type: "text"; text: string } | { type: "reasoning"; text: string } | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown } | undefined {
  if (part.type === "text") {
    return {
      type: "text",
      text: part.text
    };
  }

  if (part.type === "thinking") {
    return {
      type: "reasoning",
      text: part.thinking
    };
  }

  return {
    type: "tool-call",
    toolCallId: part.id,
    toolName: part.name,
    input: part.arguments
  };
}

function toolContentToModelOutput(content: string | ToolResultPart[]): ModelToolOutput {
  if (typeof content === "string") {
    return {
      type: "text",
      value: content
    };
  }

  if (content.every((part) => part.type === "text")) {
    return {
      type: "text",
      value: content.map((part) => part.text).join("\n")
    };
  }
  return {
    type: "content",
    value: content.map((part) =>
      part.type === "text"
        ? { type: "text", text: part.text }
        : { type: "media", data: part.data, mediaType: part.mimeType }
    )
  };
}

function toModelToolMessage(message: ToolResultMessage): ModelMessage {
  return {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        output: toolContentToModelOutput(message.content)
      }
    ]
  };
}

function conversationMessagesToModelMessages(
  model: UnifiedModel,
  messages: ConversationMessage[]
): ModelMessage[] {
  const transport = resolveModelTransport(model);
  const replayReasoning = transport !== "anthropic";
  const output: ModelMessage[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      output.push(toModelUserMessage(message));
      continue;
    }

    if (message.role === "tool") {
      output.push(toModelToolMessage(message));
      continue;
    }

    const content = message.content
      .filter((part) => replayReasoning || part.type !== "thinking")
      .map((part) => toModelAssistantPart(part))
      .filter((part): part is NonNullable<typeof part> => part !== undefined);

    if (content.length === 0) {
      continue;
    }

    output.push({
      role: "assistant",
      content
    });
  }

  return output;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

function normalizeStreamError(error: unknown): unknown {
  if (!(error instanceof Error)) {
    return error;
  }

  if (error.message.trim()) {
    return error;
  }

  const errorWithDetails = error as Error & {
    statusCode?: unknown;
    responseBody?: unknown;
    url?: unknown;
  };

  const details = [
    typeof errorWithDetails.statusCode === "number" ? `status ${errorWithDetails.statusCode}` : undefined,
    typeof errorWithDetails.responseBody === "string" && errorWithDetails.responseBody.trim()
      ? errorWithDetails.responseBody
      : undefined,
    typeof errorWithDetails.url === "string" && errorWithDetails.url.trim()
      ? `url ${errorWithDetails.url}`
      : undefined
  ].filter((value): value is string => Boolean(value));

  if (details.length === 0) {
    return error;
  }

  const normalized = new Error(details.join(" "));
  normalized.name = error.name;
  (normalized as Error & { cause?: unknown }).cause = error;
  return normalized;
}

function buildTools(options: LlmRunOptions) {
  const toolResultMap = new Map<string, StoredToolResult>();
  const scheduler = new ToolBatchScheduler({
    llmOptions: options,
    toolResultMap
  });
  const streamedToolInputs = new Set<string>();

  const tools = Object.fromEntries(
    options.tools.map((toolDef) => [
      toolDef.name,
      tool({
        description: toolDef.description,
        inputSchema: jsonSchema(toolDef.inputSchema as never),
        onInputStart: ({ toolCallId }: ToolCallOptions) => {
          options.emit({
            type: "assistant-tool-call",
            toolCallId,
            toolName: toolDef.name
          });
        },
        onInputDelta: ({ toolCallId, inputTextDelta }: { inputTextDelta: string } & ToolCallOptions) => {
          streamedToolInputs.add(toolCallId);
          options.emit({
            type: "assistant-tool-call",
            toolCallId,
            toolName: toolDef.name,
            argsText: inputTextDelta
          });
        },
        onInputAvailable: ({ toolCallId, input }: { input: unknown } & ToolCallOptions) => {
          if (streamedToolInputs.has(toolCallId)) {
            return;
          }

          options.emit({
            type: "assistant-tool-call",
            toolCallId,
            toolName: toolDef.name,
            argsText: safeStringify(input)
          });
        },
        async execute(input, { toolCallId }) {
          return scheduler.schedule(toolDef, input, toolCallId);
        },
        toModelOutput(output) {
          return toolContentToModelOutput(output as string | ToolResultPart[]);
        }
      })
    ])
  );

  return { toolResultMap, tools };
}

function coerceToolArguments(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }

  return {};
}

function stepToAssistantMessage<TOOLS extends Record<string, AiTool>>(options: LlmRunOptions, step: StepResult<TOOLS>): AssistantMessage {
  const content: AssistantMessage["content"] = [];

  for (const part of step.content) {
    if (part.type === "reasoning" && part.text) {
      content.push({ type: "thinking", thinking: part.text });
      continue;
    }

    if (part.type === "text" && part.text) {
      content.push({ type: "text", text: part.text });
      continue;
    }

    if (part.type === "tool-call") {
      content.push({
        type: "tool-call",
        id: part.toolCallId,
        name: part.toolName,
        arguments: coerceToolArguments(part.input)
      } satisfies ToolCallPart);
    }
  }

  return {
    role: "assistant",
    content,
    provider: options.model.provider,
    model: options.model.modelId,
    stopReason: mapStopReason(step.finishReason),
    timestamp: Date.now()
  };
}

function stepToToolMessages<TOOLS extends Record<string, AiTool>>(
  step: StepResult<TOOLS>,
  toolResultMap: Map<string, StoredToolResult>
): ToolResultMessage[] {
  return step.toolResults.map((toolResult) => {
    const stored = toolResultMap.get(toolResult.toolCallId);
    const content = stored?.content ?? (
      typeof toolResult.output === "string"
        ? toolResult.output
        : Array.isArray(toolResult.output)
          ? toolResult.output as ToolResultPart[]
          : JSON.stringify(toolResult.output)
    );

    return {
      role: "tool",
      toolCallId: toolResult.toolCallId,
      toolName: stored?.toolName ?? toolResult.toolName,
      input: stored?.input ?? toolResult.input,
      inputSignature: stored?.inputSignature,
      content,
      isError: stored?.isError ?? false,
      timestamp: Date.now()
    };
  });
}

export async function runAiSdkConversation(options: LlmRunOptions): Promise<ConversationMessage[]> {
  const { toolResultMap, tools } = buildTools(options);
  const providerOptions = createProviderOptions(options.model, options.thinkingLevel);
  let streamError: unknown;

  const result = streamText({
    model: createLanguageModel(options.model) as never,
    system: options.systemPrompt,
    messages: conversationMessagesToModelMessages(options.model, options.messages),
    tools: Object.keys(tools).length === 0 ? undefined : tools,
    stopWhen: stepCountIs(options.maxSteps),
    abortSignal: options.signal,
    providerOptions,
    onError: ({ error }) => {
      streamError = error;
    },
    onChunk: ({ chunk }) => {
      if (chunk.type === "text-delta") {
        options.emit({ type: "assistant-text-delta", delta: chunk.text });
        return;
      }

      if (chunk.type === "reasoning-delta") {
        options.emit({ type: "assistant-thinking-delta", delta: chunk.text });
      }
    }
  });

  let steps: Awaited<typeof result.steps>;
  try {
    steps = await result.steps;
  } catch (error) {
    if (streamError && NoOutputGeneratedError.isInstance(error)) {
      throw normalizeStreamError(streamError);
    }
    throw error;
  }

  const output: ConversationMessage[] = [];

  for (const step of steps) {
    output.push(stepToAssistantMessage(options, step));
    output.push(...stepToToolMessages(step, toolResultMap));
  }

  return output;
}

export { createLanguageModel as resolveAiSdkLanguageModel, conversationMessagesToModelMessages };
