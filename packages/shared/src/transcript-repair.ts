import { createId } from "./runtime.js";
import type {
  AssistantMessage,
  AssistantPart,
  ConversationMessage,
  ToolResultMessage,
} from "./types.js";
import type { TranscriptPolicy } from "./transcript-policy.js";

const TOOL_CALL_NAME_RE = /^[A-Za-z0-9_-]+$/u;
const TOOL_CALL_NAME_MAX_CHARS = 64;

export interface TranscriptRepairOptions {
  policy: TranscriptPolicy;
  allowedToolNames?: Iterable<string>;
}

export interface TranscriptRepairReport {
  messages: ConversationMessage[];
  addedSyntheticToolResults: number;
  droppedOrphanToolResults: number;
  droppedMalformedToolCalls: number;
  droppedAssistantMessages: number;
}

export function sanitizeConversationMessages(
  messages: ConversationMessage[],
  options: TranscriptRepairOptions
): TranscriptRepairReport {
  const sanitized = sanitizeAssistantToolCalls(messages, options);
  if (!options.policy.repairToolCallResultPairing) {
    return sanitized;
  }
  return repairToolCallResultPairing(sanitized.messages, options.policy, sanitized);
}

function sanitizeAssistantToolCalls(
  messages: ConversationMessage[],
  options: TranscriptRepairOptions
): TranscriptRepairReport {
  const allowedToolNames = normalizeAllowedToolNames(options.allowedToolNames);
  const output: ConversationMessage[] = [];
  let droppedMalformedToolCalls = 0;
  let droppedAssistantMessages = 0;

  for (const message of messages) {
    if (message.role !== "assistant") {
      output.push(message);
      continue;
    }

    const content: AssistantPart[] = [];
    for (const part of message.content) {
      if (part.type === "tool-call" && !isValidToolCall(part, allowedToolNames)) {
        droppedMalformedToolCalls += 1;
        continue;
      }

      if (part.type === "text" && !part.text.trim()) {
        continue;
      }
      if (part.type === "thinking" && !part.thinking.trim()) {
        continue;
      }
      if (part.type === "tool-call") {
        content.push({
          ...part,
          id: part.id.trim(),
          name: part.name.trim(),
        });
        continue;
      }

      content.push(part);
    }

    if (!assistantHasMeaningfulContent(content)) {
      droppedAssistantMessages += 1;
      continue;
    }

    output.push({
      ...message,
      content,
    });
  }

  return {
    messages: output,
    addedSyntheticToolResults: 0,
    droppedOrphanToolResults: 0,
    droppedMalformedToolCalls,
    droppedAssistantMessages,
  };
}

function repairToolCallResultPairing(
  messages: ConversationMessage[],
  policy: TranscriptPolicy,
  baseReport: TranscriptRepairReport
): TranscriptRepairReport {
  const output: ConversationMessage[] = [];
  let addedSyntheticToolResults = 0;
  let droppedOrphanToolResults = 0;

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (!message) {
      continue;
    }

    if (message.role !== "assistant") {
      if (message.role !== "tool") {
        output.push(message);
      } else {
        droppedOrphanToolResults += 1;
      }
      continue;
    }

    const toolCalls = message.content.filter((part): part is Extract<AssistantPart, { type: "tool-call" }> => part.type === "tool-call");
    if (toolCalls.length === 0) {
      output.push(message);
      continue;
    }

    const resultsById = new Map<string, ToolResultMessage>();
    let scanIndex = index + 1;
    for (; scanIndex < messages.length; scanIndex += 1) {
      const next = messages[scanIndex];
      if (!next || next.role !== "tool") {
        break;
      }

      if (resultsById.has(next.toolCallId)) {
        droppedOrphanToolResults += 1;
        continue;
      }
      resultsById.set(next.toolCallId, next);
    }

    output.push(message);
    for (const toolCall of toolCalls) {
      const existing = resultsById.get(toolCall.id);
      if (existing) {
        output.push(existing);
        resultsById.delete(toolCall.id);
        continue;
      }
      if (policy.allowSyntheticToolResults) {
        output.push(makeSyntheticToolResult(toolCall.id, toolCall.name));
        addedSyntheticToolResults += 1;
      }
    }

    droppedOrphanToolResults += resultsById.size;
    index = scanIndex - 1;
  }

  return {
    messages: output,
    addedSyntheticToolResults,
    droppedOrphanToolResults: baseReport.droppedOrphanToolResults + droppedOrphanToolResults,
    droppedMalformedToolCalls: baseReport.droppedMalformedToolCalls,
    droppedAssistantMessages: baseReport.droppedAssistantMessages,
  };
}

function makeSyntheticToolResult(toolCallId: string, toolName: string): ToolResultMessage {
  return {
    role: "tool",
    toolCallId,
    toolName,
    content: "[mono] missing tool result was synthesized during transcript repair.",
    isError: true,
    timestamp: Date.now(),
    inputSignature: `synthetic:${createId()}`,
  };
}

function normalizeAllowedToolNames(allowedToolNames?: Iterable<string>): Set<string> | null {
  if (!allowedToolNames) {
    return null;
  }
  const next = new Set<string>();
  for (const name of allowedToolNames) {
    const trimmed = name.trim().toLowerCase();
    if (trimmed) {
      next.add(trimmed);
    }
  }
  return next.size > 0 ? next : null;
}

function isValidToolCall(
  part: Extract<AssistantPart, { type: "tool-call" }>,
  allowedToolNames: Set<string> | null
): boolean {
  const id = part.id.trim();
  const name = part.name.trim();
  if (!id || !name) {
    return false;
  }
  if (name.length > TOOL_CALL_NAME_MAX_CHARS || !TOOL_CALL_NAME_RE.test(name)) {
    return false;
  }
  if (allowedToolNames && !allowedToolNames.has(name.toLowerCase())) {
    return false;
  }
  return true;
}

function assistantHasMeaningfulContent(content: AssistantMessage["content"]): boolean {
  return content.some((part) => {
    if (part.type === "text") {
      return part.text.trim().length > 0;
    }
    if (part.type === "thinking") {
      return part.thinking.trim().length > 0;
    }
    return true;
  });
}
