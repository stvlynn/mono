import { createId } from "@mono/shared";
import type {
  ConversationMessage,
  EpisodicEventRecord,
  MemoryEvidenceRecord,
  MonoMemoryV2Config,
  PreferenceObservationRecord,
  SalienceQueueRecord,
  SelfRuntimeRecord,
} from "@mono/shared";
import { FolderStructuredMemoryStore } from "./structured-store.js";

export interface StructuredMemoryTurnInput {
  config: MonoMemoryV2Config;
  store: FolderStructuredMemoryStore;
  entityId: string;
  userMessage: string;
  assistantMessages: ConversationMessage[];
  origin?: EpisodicEventRecord["origin"];
  sessionId?: string;
  branchHeadId?: string;
}

export interface StructuredMemoryTurnResult {
  event: EpisodicEventRecord;
  evidence: MemoryEvidenceRecord[];
  observations: PreferenceObservationRecord[];
  queueRecords: SalienceQueueRecord[];
  selfRuntime: SelfRuntimeRecord;
}

export async function persistStructuredMemoryTurn(input: StructuredMemoryTurnInput): Promise<StructuredMemoryTurnResult> {
  await input.store.ensureLayout();
  const now = Date.now();
  const assistantSummaries = collectAssistantSummaries(input.assistantMessages);
  const observations = extractPreferenceObservations(input.userMessage, input.sessionId, input.branchHeadId, now);

  const event = await input.store.appendEpisodicEvent({
    createdAt: now,
    origin: input.origin ?? "user_task",
    entityId: input.entityId,
    sessionId: input.sessionId,
    branchHeadId: input.branchHeadId,
    queryText: input.userMessage,
    summary: buildEventSummary(input.userMessage, assistantSummaries),
    messages: [input.userMessage, ...assistantSummaries].slice(0, 4),
    salience: observations.length > 0 ? 0.9 : 0.4,
    extractedPreferenceKeys: observations.map((item) => item.key)
  });

  const evidence = await appendEvidenceRecords(input.store, input.entityId, observations, input.sessionId, event.id, now);
  const queueRecords = await appendSalienceQueueRecords(input.store, input.entityId, event, observations, now);
  const selfRuntime = await updateSelfRuntime(input.store, input.userMessage, observations);

  return {
    event,
    evidence,
    observations,
    queueRecords,
    selfRuntime
  };
}

function collectAssistantSummaries(messages: ConversationMessage[]): string[] {
  return messages
    .filter((message): message is Extract<ConversationMessage, { role: "assistant" }> => message.role === "assistant")
    .map((message) =>
      message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text.trim())
        .filter(Boolean)
        .join(" ")
    )
    .filter(Boolean)
    .slice(-2);
}

function buildEventSummary(userMessage: string, assistantSummaries: string[]): string {
  return [
    `User request: ${summarize(userMessage, 180)}`,
    assistantSummaries[0] ? `Assistant outcome: ${summarize(assistantSummaries[0], 180)}` : "",
  ].filter(Boolean).join("\n");
}

async function appendEvidenceRecords(
  store: FolderStructuredMemoryStore,
  entityId: string,
  observations: PreferenceObservationRecord[],
  sessionId: string | undefined,
  eventId: string,
  createdAt: number
): Promise<MemoryEvidenceRecord[]> {
  const evidence: MemoryEvidenceRecord[] = [];
  for (const observation of observations) {
    const record = await store.appendEvidence(entityId, {
      createdAt,
      type: "explicit_preference",
      content: observation.summary,
      summary: observation.summary,
      weight: observation.confidence,
      sessionId,
      eventId,
      tags: [observation.key, observation.polarity]
    });
    evidence.push(record);
    observation.evidenceIds = [record.id];
  }
  return evidence;
}

async function appendSalienceQueueRecords(
  store: FolderStructuredMemoryStore,
  entityId: string,
  event: EpisodicEventRecord,
  observations: PreferenceObservationRecord[],
  createdAt: number
): Promise<SalienceQueueRecord[]> {
  const queueRecords: SalienceQueueRecord[] = [];
  if (observations.length === 0) {
    return queueRecords;
  }

  for (const observation of observations) {
    queueRecords.push(await store.appendSalienceQueueRecord({
      entityId,
      createdAt,
      eventId: event.id,
      salience: event.salience,
      reason: summarize(event.queryText, 120),
      status: "pending",
      observation
    }));
  }

  return queueRecords;
}

async function updateSelfRuntime(
  store: FolderStructuredMemoryStore,
  userMessage: string,
  observations: PreferenceObservationRecord[]
): Promise<SelfRuntimeRecord> {
  const current = await store.getSelfRuntime();
  const currentGoals = uniqueTail([...current.currentGoals, summarize(userMessage, 120)], 6);
  const currentTensions = uniqueTail([
    ...current.currentTensions,
    ...observations.filter((item) => item.polarity === "avoid").map((item) => item.summary)
  ], 6);
  const taskHints = uniqueTail([
    ...current.taskHints,
    ...observations.map((item) => item.summary)
  ], 6);
  return store.upsertSelfRuntime({
    currentGoals,
    currentTensions,
    taskHints,
    openQuestions: current.openQuestions,
    currentHypotheses: current.currentHypotheses,
    frictionPatterns: current.frictionPatterns,
    autonomyPolicy: current.autonomyPolicy,
    cooldowns: current.cooldowns
  });
}

function extractPreferenceObservations(
  text: string,
  sessionId: string | undefined,
  branchHeadId: string | undefined,
  observedAt: number
): PreferenceObservationRecord[] {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }

  const candidates = PREFERENCE_PATTERNS.flatMap((pattern) => {
    if (!pattern.patterns.some((regex) => regex.test(normalized))) {
      return [];
    }

    return [{
      id: createId(),
      key: pattern.key,
      summary: pattern.summary,
      polarity: pattern.polarity,
      confidence: pattern.weight,
      evidenceIds: [],
      contextKey: buildContextKey(sessionId, branchHeadId),
      observedAt
    } satisfies PreferenceObservationRecord];
  });

  if (candidates.length > 0) {
    return dedupeObservations(candidates);
  }

  if (!EXPLICIT_PREFERENCE_MARKERS.some((regex) => regex.test(normalized))) {
    return [];
  }

  return [{
    id: createId(),
    key: toPreferenceKey(normalized, sessionId),
    summary: summarize(normalized, 160),
    polarity: /(不要|别|不喜欢|avoid|don't|do not)/iu.test(normalized) ? "avoid" : "prefer",
    confidence: 0.8,
    evidenceIds: [],
    contextKey: buildContextKey(sessionId, branchHeadId),
    observedAt
  }];
}

function dedupeObservations(items: PreferenceObservationRecord[]): PreferenceObservationRecord[] {
  const deduped = new Map<string, PreferenceObservationRecord>();
  for (const item of items) {
    deduped.set(item.key, item);
  }
  return [...deduped.values()];
}

function buildContextKey(sessionId: string | undefined, branchHeadId: string | undefined): string {
  return [sessionId ?? "session", branchHeadId ?? "root"].join(":");
}

function toPreferenceKey(text: string, sessionId: string | undefined): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 48);
  return slug || `${sessionId ?? "default"}_${createId().slice(0, 8)}`;
}

function summarize(text: string, limit: number): string {
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 1)}…`;
}

function uniqueTail(items: string[], limit: number): string[] {
  return [...new Set(items.filter(Boolean))].slice(-limit);
}

const EXPLICIT_PREFERENCE_MARKERS = [
  /prefer/iu,
  /please/iu,
  /avoid/iu,
  /don't/iu,
  /do not/iu,
  /不要/iu,
  /别/iu,
  /请/iu,
  /希望/iu,
  /不喜欢/iu
];

const PREFERENCE_PATTERNS: Array<{
  key: string;
  summary: string;
  polarity: PreferenceObservationRecord["polarity"];
  weight: number;
  patterns: RegExp[];
}> = [
  {
    key: "prefers_directness",
    summary: "Prefer direct, low-friction responses.",
    polarity: "prefer",
    weight: 0.94,
    patterns: [/直接/iu, /\bdirect\b/iu]
  },
  {
    key: "prefers_brief_answers",
    summary: "Prefer concise answers by default.",
    polarity: "prefer",
    weight: 0.9,
    patterns: [/简短/iu, /\bbrief\b/iu, /\bconcise\b/iu]
  },
  {
    key: "avoid_unsolicited_summaries",
    summary: "Avoid unsolicited summaries or over-structuring.",
    polarity: "avoid",
    weight: 0.95,
    patterns: [/不要.*总结/iu, /不要.*拆解/iu, /don't.*summar/iu]
  },
  {
    key: "avoid_unsolicited_reassurance",
    summary: "Avoid unsolicited reassurance or motivational padding.",
    polarity: "avoid",
    weight: 0.95,
    patterns: [/不要.*安抚/iu, /don't.*reassur/iu]
  },
  {
    key: "avoid_unsolicited_assumptions",
    summary: "Avoid making assumptions or taking initiative without confirmation.",
    polarity: "avoid",
    weight: 0.92,
    patterns: [/不要.*自作主张/iu, /don't.*assum/iu, /don't.*take initiative/iu]
  }
];
