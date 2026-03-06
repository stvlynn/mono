import { createHash } from "node:crypto";
import { resolve as resolvePath } from "node:path";
import type { ConversationMessage, MemoryRecallPlan, MemoryRecord, UserMessage } from "@mono/shared";

export interface RecallAccumulator {
  rootIds: Set<string>;
  compactedIds: Set<string>;
  rawPairIds: Set<string>;
  selectedIds: Set<string>;
}

export function createRecallAccumulator(): RecallAccumulator {
  return {
    rootIds: new Set<string>(),
    compactedIds: new Set<string>(),
    rawPairIds: new Set<string>(),
    selectedIds: new Set<string>()
  };
}

export function emptyRecallPlan(): MemoryRecallPlan {
  return {
    rootIds: [],
    compactedIds: [],
    rawPairIds: [],
    selectedIds: []
  };
}

export function collapseRecallAccumulator(accumulator: RecallAccumulator): MemoryRecallPlan | undefined {
  if (accumulator.selectedIds.size === 0) {
    return undefined;
  }

  return {
    rootIds: [...accumulator.rootIds],
    compactedIds: [...accumulator.compactedIds],
    rawPairIds: [...accumulator.rawPairIds],
    selectedIds: [...accumulator.selectedIds]
  };
}

export function mergeRecallPlan(accumulator: RecallAccumulator, plan: MemoryRecallPlan): void {
  for (const id of plan.rootIds) accumulator.rootIds.add(id);
  for (const id of plan.compactedIds) accumulator.compactedIds.add(id);
  for (const id of plan.rawPairIds) accumulator.rawPairIds.add(id);
  for (const id of plan.selectedIds) accumulator.selectedIds.add(id);
}

export function resolveMemoryStorePath(cwd: string, configuredPath: string): string {
  if (configuredPath.startsWith("/")) {
    return configuredPath;
  }
  return resolvePath(cwd, configuredPath);
}

export function projectKeyFromCwd(cwd: string): string {
  return createHash("sha1").update(cwd).digest("hex").slice(0, 12);
}

export function buildDetailedTrace(userMessage: UserMessage, messages: ConversationMessage[]): MemoryRecord["detailed"] {
  const trace: MemoryRecord["detailed"] = [
    {
      type: "user",
      text:
        typeof userMessage.content === "string"
          ? userMessage.content
          : userMessage.content.map((part) => ("text" in part ? part.text : `[image:${part.mimeType}]`)).join("\n")
    }
  ];

  for (const message of messages) {
    if (message.role === "assistant") {
      trace.push(buildAssistantTrace(message));
      for (const toolCall of message.content.filter((part) => part.type === "tool-call")) {
        trace.push({
          type: "tool_call",
          toolName: toolCall.name,
          args: toolCall.arguments,
          toolCallId: toolCall.id
        });
      }
      continue;
    }

    if (message.role === "tool") {
      trace.push({
        type: "tool_result",
        toolName: message.toolName,
        output:
          typeof message.content === "string"
            ? message.content
            : message.content
                .map((part) => (part.type === "text" ? part.text : `[image:${part.mimeType}]`))
                .join("\n"),
        truncated: false
      });
    }
  }

  return trace;
}

function buildAssistantTrace(message: Extract<ConversationMessage, { role: "assistant" }>): MemoryRecord["detailed"][number] {
  const text = message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
  const thinking = message.content
    .filter((part) => part.type === "thinking")
    .map((part) => part.thinking)
    .join("\n")
    .trim();

  return {
    type: "assistant",
    ...(text ? { text } : {}),
    ...(thinking ? { thinking } : {})
  };
}
