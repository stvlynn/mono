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
import { resolveTranscriptPolicy, sanitizeConversationMessages } from "@mono/shared";
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
import type { LlmRunOptions, LlmTextStreamOptions } from "./types.js";
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

function isOfficialOpenAiBaseURL(baseURL: string): boolean {
  try {
    const normalized = new URL(baseURL.trim());
    return normalized.protocol === "https:"
      && normalized.hostname === "api.openai.com"
      && normalized.pathname.replace(/\/+$/u, "") === "/v1";
  } catch {
    return false;
  }
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

  const providerName = transport === "openai-responses"
    ? "openai"
    : model.providerFactory === "openai" || model.provider === "openai"
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

  if (transport === "openai-responses") {
    return createOpenAI({
      apiKey,
      baseURL: model.baseURL
    }).responses(model.modelId);
  }

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

  if (model.providerFactory === "openai" && isOfficialOpenAiBaseURL(model.baseURL)) {
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

function buildModelUserParts(
  content: UserPart[]
): Array<{ type: "text"; text: string } | { type: "image"; image: string; mediaType: string }> {
  const parts = content.map(toModelUserPart);
  const hasText = parts.some((part) => part.type === "text" && part.text.trim().length > 0);
  if (hasText) {
    return parts;
  }

  return [
    ...parts,
    {
      type: "text",
      text: parts.length === 1 ? "User sent an image." : `User sent ${parts.length} images.`
    }
  ];
}

function toModelUserMessage(message: UserMessage): ModelMessage {
  return {
    role: "user",
    content: typeof message.content === "string" ? message.content : buildModelUserParts(message.content)
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
  messages: ConversationMessage[],
  allowedToolNames?: Iterable<string>
): ModelMessage[] {
  const sanitized = sanitizeConversationMessages(messages, {
    policy: resolveTranscriptPolicy(model),
    allowedToolNames
  }).messages;
  const transport = resolveModelTransport(model);
  const replayReasoning = transport !== "anthropic";
  const output: ModelMessage[] = [];

  for (const message of sanitized) {
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

const REASONING_WRAPPER_TAGS = ["think", "thinking", "reasoning", "analysis"] as const;

function findEarliestReasoningOpenTag(text: string): { index: number; tag: string; token: string } | undefined {
  let match: { index: number; tag: string; token: string } | undefined;

  for (const tag of REASONING_WRAPPER_TAGS) {
    const token = `<${tag}>`;
    const index = text.indexOf(token);
    if (index < 0) {
      continue;
    }
    if (!match || index < match.index) {
      match = { index, tag, token };
    }
  }

  return match;
}

function longestSuffixThatCouldStartToken(text: string, token: string): string {
  const maxLength = Math.min(text.length, token.length - 1);
  for (let length = maxLength; length > 0; length -= 1) {
    const suffix = text.slice(-length);
    if (token.startsWith(suffix)) {
      return suffix;
    }
  }
  return "";
}

function longestSuffixThatCouldStartAnyReasoningOpenTag(text: string): string {
  let best = "";
  for (const tag of REASONING_WRAPPER_TAGS) {
    const candidate = longestSuffixThatCouldStartToken(text, `<${tag}>`);
    if (candidate.length > best.length) {
      best = candidate;
    }
  }
  return best;
}

function extractReasoningWrappedSegments(text: string): Array<{ type: "text" | "thinking"; text: string }> {
  const segments: Array<{ type: "text" | "thinking"; text: string }> = [];
  let remaining = text;

  const push = (type: "text" | "thinking", value: string) => {
    if (!value) {
      return;
    }
    const previous = segments.at(-1);
    if (previous?.type === type) {
      previous.text += value;
      return;
    }
    segments.push({ type, text: value });
  };

  while (remaining.length > 0) {
    const open = findEarliestReasoningOpenTag(remaining);
    if (!open) {
      push("text", remaining);
      break;
    }

    push("text", remaining.slice(0, open.index));
    const afterOpen = remaining.slice(open.index + open.token.length);
    const closeToken = `</${open.tag}>`;
    const closeIndex = afterOpen.indexOf(closeToken);
    if (closeIndex < 0) {
      push("thinking", afterOpen);
      break;
    }

    push("thinking", afterOpen.slice(0, closeIndex));
    remaining = afterOpen.slice(closeIndex + closeToken.length);
  }

  return segments;
}

function createReasoningWrapperStreamParser() {
  let mode: "text" | "thinking" = "text";
  let activeTag: string | undefined;
  let pending = "";

  return {
    push(chunk: string): { textDelta: string; thinkingDelta: string } {
      let input = pending + chunk;
      let textDelta = "";
      let thinkingDelta = "";
      pending = "";

      while (input.length > 0) {
        if (mode === "text") {
          const open = findEarliestReasoningOpenTag(input);
          if (open) {
            textDelta += input.slice(0, open.index);
            input = input.slice(open.index + open.token.length);
            mode = "thinking";
            activeTag = open.tag;
            continue;
          }

          const partial = longestSuffixThatCouldStartAnyReasoningOpenTag(input);
          textDelta += input.slice(0, input.length - partial.length);
          pending = partial;
          input = "";
          continue;
        }

        const closeToken = `</${activeTag}>`;
        const closeIndex = input.indexOf(closeToken);
        if (closeIndex >= 0) {
          thinkingDelta += input.slice(0, closeIndex);
          input = input.slice(closeIndex + closeToken.length);
          mode = "text";
          activeTag = undefined;
          continue;
        }

        const partial = longestSuffixThatCouldStartToken(input, closeToken);
        thinkingDelta += input.slice(0, input.length - partial.length);
        pending = partial;
        input = "";
      }

      return { textDelta, thinkingDelta };
    },
    finish(): { textDelta: string; thinkingDelta: string } {
      if (!pending) {
        return { textDelta: "", thinkingDelta: "" };
      }

      if (mode === "text") {
        const textDelta = pending;
        pending = "";
        return { textDelta, thinkingDelta: "" };
      }

      pending = "";
      return { textDelta: "", thinkingDelta: "" };
    },
  };
}

function stepToAssistantMessage<TOOLS extends Record<string, AiTool>>(options: LlmRunOptions, step: StepResult<TOOLS>): AssistantMessage {
  const content: AssistantMessage["content"] = [];
  const seenThinking = new Set<string>();

  const pushAssistantPart = (part: AssistantMessage["content"][number]) => {
    if (part.type === "thinking") {
      const key = part.thinking.trim();
      if (!key || seenThinking.has(key)) {
        return;
      }
      seenThinking.add(key);
    }

    const previous = content.at(-1);
    if (previous?.type === "text" && part.type === "text") {
      previous.text += part.text;
      return;
    }
    if (previous?.type === "thinking" && part.type === "thinking") {
      previous.thinking += part.thinking;
      return;
    }
    content.push(part);
  };

  for (const part of step.content) {
    if (part.type === "reasoning" && part.text) {
      pushAssistantPart({ type: "thinking", thinking: part.text });
      continue;
    }

    if (part.type === "text" && part.text) {
      for (const segment of extractReasoningWrappedSegments(part.text)) {
        if (segment.type === "thinking") {
          pushAssistantPart({ type: "thinking", thinking: segment.text });
        } else {
          pushAssistantPart({ type: "text", text: segment.text });
        }
      }
      continue;
    }

    if (part.type === "tool-call") {
      pushAssistantPart({
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
  const wrapperParser = createReasoningWrapperStreamParser();
  let streamError: unknown;

  const result = streamText({
    model: createLanguageModel(options.model) as never,
    system: options.systemPrompt,
    messages: conversationMessagesToModelMessages(options.model, options.messages, options.tools.map((tool) => tool.name)),
    tools: Object.keys(tools).length === 0 ? undefined : tools,
    stopWhen: stepCountIs(options.maxSteps),
    abortSignal: options.signal,
    providerOptions,
    onError: ({ error }) => {
      streamError = error;
    },
    onChunk: ({ chunk }) => {
      if (chunk.type === "text-delta") {
        const parsed = wrapperParser.push(chunk.text);
        if (parsed.textDelta) {
          options.emit({ type: "assistant-text-delta", delta: parsed.textDelta });
        }
        if (parsed.thinkingDelta) {
          options.emit({ type: "assistant-thinking-delta", delta: parsed.thinkingDelta });
        }
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

  const trailing = wrapperParser.finish();
  if (trailing.textDelta) {
    options.emit({ type: "assistant-text-delta", delta: trailing.textDelta });
  }
  if (trailing.thinkingDelta) {
    options.emit({ type: "assistant-thinking-delta", delta: trailing.thinkingDelta });
  }

  const output: ConversationMessage[] = [];

  for (const step of steps) {
    output.push(stepToAssistantMessage(options, step));
    output.push(...stepToToolMessages(step, toolResultMap));
  }

  return output;
}

export async function streamAiSdkText(options: LlmTextStreamOptions): Promise<string> {
  const providerOptions = createProviderOptions(options.model, options.thinkingLevel);
  const wrapperParser = createReasoningWrapperStreamParser();
  let streamError: unknown;
  let output = "";

  const result = streamText({
    model: createLanguageModel(options.model) as never,
    system: options.systemPrompt,
    messages: conversationMessagesToModelMessages(options.model, options.messages, []),
    abortSignal: options.signal,
    providerOptions,
    onError: ({ error }) => {
      streamError = error;
    },
    onChunk: ({ chunk }) => {
      if (chunk.type === "text-delta") {
        const parsed = wrapperParser.push(chunk.text);
        if (parsed.textDelta) {
          output += parsed.textDelta;
          options.onTextDelta?.(parsed.textDelta);
        }
        if (parsed.thinkingDelta) {
          options.onThinkingDelta?.(parsed.thinkingDelta);
        }
        return;
      }

      if (chunk.type === "reasoning-delta") {
        options.onThinkingDelta?.(chunk.text);
      }
    },
  });

  try {
    await result.text;
  } catch (error) {
    if (streamError && NoOutputGeneratedError.isInstance(error)) {
      throw normalizeStreamError(streamError);
    }
    throw error;
  }

  const trailing = wrapperParser.finish();
  if (trailing.textDelta) {
    output += trailing.textDelta;
    options.onTextDelta?.(trailing.textDelta);
  }
  if (trailing.thinkingDelta) {
    options.onThinkingDelta?.(trailing.thinkingDelta);
  }

  return output;
}

export { createLanguageModel as resolveAiSdkLanguageModel, conversationMessagesToModelMessages };
