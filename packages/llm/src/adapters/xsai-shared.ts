import { streamText } from "@xsai/stream-text";
import type { StreamTextEvent } from "@xsai/stream-text";
import type { AssistantMessage, ConversationMessage, TextPart, ToolCallPart, ToolResultMessage, ToolResultPart } from "@mono/shared";
import type { LlmRunOptions } from "./types.js";
import { ToolBatchScheduler } from "./tool-batch-scheduler.js";

function toXsaiContent(parts: ToolResultPart[]): Array<Record<string, unknown>> {
  return parts.map((part) => {
    if (part.type === "text") {
      return { type: "text", text: part.text };
    }

    return {
      type: "image_url",
      image_url: {
        url: `data:${part.mimeType};base64,${part.data}`
      }
    };
  });
}

export function toXsaiMessage(message: ConversationMessage): Record<string, unknown> {
  if (message.role === "user") {
    return {
      role: "user",
      content:
        typeof message.content === "string"
          ? message.content
          : message.content.map((part) =>
              part.type === "text"
                ? { type: "text", text: part.text }
                : { type: "image_url", image_url: { url: `data:${part.mimeType};base64,${part.data}` } }
            )
    };
  }

  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      content: typeof message.content === "string" ? message.content : toXsaiContent(message.content)
    };
  }

  const textParts = message.content.filter((part): part is TextPart => part.type === "text");
  const toolCalls = message.content
    .filter((part): part is ToolCallPart => part.type === "tool-call")
    .map((part) => ({
      id: part.id,
      type: "function",
      function: {
        name: part.name,
        arguments: JSON.stringify(part.arguments)
      }
    }));
  const thinking = message.content
    .filter((part) => part.type === "thinking")
    .map((part) => part.thinking)
    .join("");

  return {
    role: "assistant",
    content: textParts.length === 0 ? "" : textParts.map((part) => ({ type: "text", text: part.text })),
    ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    ...(thinking ? { reasoning: thinking } : {})
  };
}

export function mapStopReason(finishReason: string): AssistantMessage["stopReason"] {
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

export function mapOpenAIThinkingLevel(level: LlmRunOptions["thinkingLevel"]): "none" | "minimal" | "medium" | "high" | "xhigh" {
  if (level === "off") {
    return "none";
  }

  if (level === "low") {
    return "minimal";
  }

  return level;
}

export function mapAnthropicThinking(level: LlmRunOptions["thinkingLevel"]): { type: "enabled"; budget_tokens: number } | undefined {
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
    budget_tokens: budgetByLevel[level === "xhigh" ? "high" : level]
  };
}

function buildXsaiTools(options: LlmRunOptions) {
  const toolResultMap = new Map<
    string,
    { toolName: string; input: unknown; inputSignature: string; content: string | ToolResultPart[]; isError: boolean }
  >();
  const scheduler = new ToolBatchScheduler({
    llmOptions: options,
    toolResultMap,
    toXsaiContent
  });

  const tools = options.tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      strict: true
    },
    execute: async (input: unknown, toolContext: { toolCallId: string }) =>
      scheduler.schedule(tool, input, toolContext.toolCallId)
  }));

  return { toolResultMap, tools };
}

export async function runXsaiConversation(
  options: LlmRunOptions,
  xsaiConfig: Record<string, unknown>
): Promise<ConversationMessage[]> {
  const originalMessages = options.messages.map(toXsaiMessage);
  const { toolResultMap, tools } = buildXsaiTools(options);
  const config = xsaiConfig as Record<string, unknown>;
  const result = streamText({
    ...config,
    abortSignal: options.signal,
    messages: [{ role: "system", content: options.systemPrompt } as never, ...(originalMessages as never[])],
    tools,
    maxSteps: options.maxSteps,
    onEvent: (event: StreamTextEvent) => {
      switch (event.type) {
        case "text-delta":
          options.emit({ type: "assistant-text-delta", delta: event.text });
          break;
        case "reasoning-delta":
          options.emit({ type: "assistant-thinking-delta", delta: event.text });
          break;
        case "tool-call-streaming-start":
          options.emit({
            type: "assistant-tool-call",
            toolCallId: event.toolCallId,
            toolName: event.toolName
          });
          break;
        case "tool-call-delta":
          options.emit({
            type: "assistant-tool-call",
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            argsText: event.argsTextDelta
          });
          break;
        default:
          break;
      }
    }
  } as never);

  const [allMessages, steps] = await Promise.all([result.messages, result.steps]);
  const newMessages = allMessages.slice(originalMessages.length + 1);
  const output: ConversationMessage[] = [];
  let assistantStepIndex = 0;
  let toolIndex = 0;

  for (const message of newMessages) {
    if (message.role === "assistant") {
      const step = steps[assistantStepIndex++];
      const content: AssistantMessage["content"] = [];
      const reasoningText =
        typeof message.reasoning === "string"
          ? message.reasoning
          : typeof message.reasoning_content === "string"
            ? message.reasoning_content
            : "";

      if (reasoningText) {
        content.push({ type: "thinking", thinking: reasoningText });
      }

      if (typeof message.content === "string") {
        if (message.content) {
          content.push({ type: "text", text: message.content });
        }
      } else if (Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part.type === "text") {
            content.push({ type: "text", text: part.text });
          }
        }
      }

      for (const toolCall of message.tool_calls ?? []) {
        content.push({
          type: "tool-call",
          id: toolCall.id,
          name: toolCall.function.name ?? "unknown",
          arguments: JSON.parse(toolCall.function.arguments || "{}") as Record<string, unknown>
        });
      }

      output.push({
        role: "assistant",
        content,
        provider: options.model.provider,
        model: options.model.modelId,
        stopReason: mapStopReason(step?.finishReason ?? "stop"),
        timestamp: Date.now()
      });
      continue;
    }

    if (message.role === "tool") {
      const stepResults = steps.flatMap((item) => item.toolResults);
      const toolStep = stepResults[toolIndex++];
      const stored = toolResultMap.get(message.tool_call_id);
      output.push({
        role: "tool",
        toolCallId: message.tool_call_id,
        toolName: stored?.toolName ?? toolStep?.toolName ?? "unknown",
        input: stored?.input,
        inputSignature: stored?.inputSignature,
        content: stored?.content ?? (typeof message.content === "string" ? message.content : []),
        isError: stored?.isError ?? false,
        timestamp: Date.now()
      } satisfies ToolResultMessage);
    }
  }

  return output;
}
