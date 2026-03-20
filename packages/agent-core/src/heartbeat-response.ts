import {
  createId,
  type AutonomyIntent,
  type ConversationMessage,
  type HeartbeatReplyRecord,
  getLastAssistantText
} from "@mono/shared";

export const HEARTBEAT_ACK_TOKEN = "HEARTBEAT_OK";
export const DEFAULT_HEARTBEAT_ACK_MAX_CHARS = 300;

export interface HeartbeatReplyEvaluation {
  status: HeartbeatReplyRecord["status"];
  rawText: string;
  normalizedText: string;
  visibleText: string;
  reason: string;
}

export interface CuriosityReplyFields {
  question?: string;
  hypothesis?: string;
  evidence?: string;
}

export function extractHeartbeatReplyText(messages: ConversationMessage[]): string {
  const assistantMessages = messages.filter((message) => message.role === "assistant");
  for (let index = assistantMessages.length - 1; index >= 0; index -= 1) {
    const text = getLastAssistantText(assistantMessages[index]!);
    if (text.trim()) {
      return text;
    }
  }
  return "";
}

export function evaluateHeartbeatReply(input: {
  messages: ConversationMessage[];
  previousNormalizedText?: string;
  ackToken?: string;
  ackMaxChars?: number;
}): HeartbeatReplyEvaluation {
  const rawText = extractHeartbeatReplyText(input.messages);
  const normalizedText = normalizeHeartbeatReply(rawText);
  const ackToken = input.ackToken ?? HEARTBEAT_ACK_TOKEN;
  const ackMaxChars = input.ackMaxChars ?? DEFAULT_HEARTBEAT_ACK_MAX_CHARS;
  const stripped = stripHeartbeatAck(normalizedText, ackToken, ackMaxChars);

  if (stripped.status !== "sent") {
    return {
      ...stripped,
      rawText,
      normalizedText,
    };
  }

  if (input.previousNormalizedText && stripped.visibleText === input.previousNormalizedText) {
    return {
      status: "duplicate",
      rawText,
      normalizedText,
      visibleText: stripped.visibleText,
      reason: "duplicate-reply",
    };
  }

  return {
    status: "sent",
    rawText,
    normalizedText,
    visibleText: stripped.visibleText,
    reason: "reply-sent",
  };
}

export function buildHeartbeatReplyRecord(input: {
  sessionId: string;
  intentId?: string;
  comparisonKey: string;
  evaluation: HeartbeatReplyEvaluation;
  createdAt?: number;
}): Omit<HeartbeatReplyRecord, "id"> & { id: string } {
  return {
    id: createId(),
    createdAt: input.createdAt ?? Date.now(),
    sessionId: input.sessionId,
    intentId: input.intentId,
    comparisonKey: input.comparisonKey,
    status: input.evaluation.status,
    rawText: input.evaluation.rawText,
    normalizedText: input.evaluation.visibleText,
    reason: input.evaluation.reason,
  };
}

export function buildHeartbeatReplyComparisonKey(intent: AutonomyIntent): string {
  return `${intent.kind}:${normalizeHeartbeatReply(intent.goal)}`;
}

export function extractCuriosityReplyFields(text: string): CuriosityReplyFields {
  return {
    question: extractTaggedValue(text, "curiosity-question"),
    hypothesis: extractTaggedValue(text, "curiosity-hypothesis"),
    evidence: extractTaggedValue(text, "curiosity-evidence"),
  };
}

export function normalizeHeartbeatReply(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function stripHeartbeatAck(
  text: string,
  ackToken: string,
  ackMaxChars: number
): Omit<HeartbeatReplyEvaluation, "rawText" | "normalizedText"> {
  if (!text) {
    return {
      status: "suppressed",
      visibleText: "",
      reason: "empty-reply",
    };
  }

  const stripped = stripBoundaryAck(text, ackToken).trim();
  const ackDetected = stripped !== text.trim();
  if (ackDetected && stripped.length <= ackMaxChars) {
    return {
      status: "ack",
      visibleText: stripped,
      reason: "heartbeat-ack",
    };
  }
  if (!stripped) {
    return {
      status: "suppressed",
      visibleText: "",
      reason: "empty-reply",
    };
  }
  return {
    status: "sent",
    visibleText: stripped,
    reason: "reply-sent",
  };
}

function stripBoundaryAck(text: string, ackToken: string): string {
  const escapedToken = escapeRegExp(ackToken);
  const leading = new RegExp(`^${escapedToken}(?=$|\\s|[\\p{P}\\p{S}])\\s*`, "u");
  const trailing = new RegExp(`\\s*${escapedToken}$`, "u");
  return text.replace(leading, "").replace(trailing, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function extractTaggedValue(text: string, tagName: string): string | undefined {
  const pattern = new RegExp(`(?:^|\\n)\\[${escapeRegExp(tagName)}:([^\\]\\n]+)\\]`, "u");
  const match = pattern.exec(text);
  const value = match?.[1]?.trim();
  return value || undefined;
}
