import { createId } from "@mono/shared";
import type {
  ConversationMessage,
  EpisodicEventRecord,
  MemoryEvidenceRecord,
  MonoMemoryV2Config,
  OtherInferenceRecord,
  OtherPreferenceRecord,
  OtherPreferencesRecord,
  OtherRelationshipStateRecord
} from "@mono/shared";
import { FolderStructuredMemoryStore } from "./structured-store.js";

export interface StructuredMemoryTurnInput {
  config: MonoMemoryV2Config;
  store: FolderStructuredMemoryStore;
  entityId: string;
  userMessage: string;
  assistantMessages: ConversationMessage[];
  sessionId?: string;
  branchHeadId?: string;
}

export interface StructuredMemoryTurnResult {
  event: EpisodicEventRecord;
  evidence: MemoryEvidenceRecord[];
  preferences: OtherPreferencesRecord;
  inferences: OtherInferenceRecord[];
  relationshipState: OtherRelationshipStateRecord;
}

export async function persistStructuredMemoryTurn(input: StructuredMemoryTurnInput): Promise<StructuredMemoryTurnResult> {
  await input.store.ensureLayout();
  const summaries = collectAssistantSummaries(input.assistantMessages);
  const extracted = extractPreferenceEvidence(input.userMessage, input.entityId, input.sessionId);
  const event = await input.store.appendEpisodicEvent({
    createdAt: Date.now(),
    entityId: input.entityId,
    sessionId: input.sessionId,
    branchHeadId: input.branchHeadId,
    queryText: input.userMessage,
    summary: buildEventSummary(input.userMessage, summaries),
    messages: [input.userMessage, ...summaries].slice(0, 4),
    salience: extracted.length > 0 ? 0.9 : 0.4,
    extractedPreferenceKeys: extracted.map((item) => item.preference.key)
  });

  const evidence: MemoryEvidenceRecord[] = [];
  for (const item of extracted) {
    evidence.push(
      await input.store.appendEvidence(input.entityId, {
        createdAt: Date.now(),
        type: item.type,
        content: item.content,
        summary: item.preference.summary,
        weight: item.weight,
        sessionId: input.sessionId,
        eventId: event.id,
        tags: [item.preference.key, item.preference.polarity]
      })
    );
  }

  const preferences = await consolidatePreferences(input.store, input.config, input.entityId, extracted, evidence);
  const inferences = input.config.enableInference
    ? await consolidateInferences(input.store, input.config, input.entityId, preferences.items)
    : [];
  const relationshipState = await updateRelationshipState(input.store, input.entityId, preferences.items);
  await input.store.writeOtherPreferences(input.entityId, preferences);
  await input.store.writeOtherInferences(input.entityId, inferences);
  await input.store.upsertRelationshipState(input.entityId, relationshipState);

  const currentProfile = await input.store.getOtherProfile(input.entityId);
  const communicationNotes = [
    ...currentProfile.communicationNotes,
    ...preferences.items
      .filter((item) => item.key === "prefers_directness" || item.key === "prefers_brief_answers")
      .map((item) => item.summary)
  ];
  await input.store.upsertOtherProfile(input.entityId, {
    communicationNotes: [...new Set(communicationNotes)].slice(-6)
  });

  return {
    event,
    evidence,
    preferences,
    inferences,
    relationshipState
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
  const parts = [
    `User request: ${summarize(userMessage, 180)}`,
    assistantSummaries[0] ? `Assistant outcome: ${summarize(assistantSummaries[0], 180)}` : ""
  ];
  return parts.filter(Boolean).join("\n");
}

function summarize(text: string, limit: number): string {
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 1)}…`;
}

function extractPreferenceEvidence(
  text: string,
  entityId: string,
  sessionId?: string
): Array<{
  type: MemoryEvidenceRecord["type"];
  content: string;
  weight: number;
  preference: OtherPreferenceRecord;
}> {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }

  const candidates = PREFERENCE_PATTERNS.flatMap((pattern) => {
    if (!pattern.patterns.some((regex) => regex.test(normalized))) {
      return [];
    }
    return [{
      type: "explicit_preference" as const,
      content: normalized,
      weight: pattern.weight,
      preference: {
        key: pattern.key,
        summary: pattern.summary,
        polarity: pattern.polarity,
        confidence: pattern.weight,
        evidenceIds: [],
        updatedAt: Date.now()
      }
    }];
  });

  if (candidates.length > 0) {
    return dedupePreferenceCandidates(candidates);
  }

  if (!EXPLICIT_PREFERENCE_MARKERS.some((regex) => regex.test(normalized))) {
    return [];
  }

  const derivedKey = toPreferenceKey(normalized, sessionId, entityId);
  return [{
    type: "explicit_preference",
    content: normalized,
    weight: 0.8,
    preference: {
      key: derivedKey,
      summary: summarize(normalized, 160),
      polarity: /(不要|别|不喜欢|avoid|don't|do not)/iu.test(normalized) ? "avoid" : "prefer",
      confidence: 0.8,
      evidenceIds: [],
      updatedAt: Date.now()
    }
  }];
}

function dedupePreferenceCandidates<T extends { preference: { key: string } }>(items: T[]): T[] {
  const deduped = new Map<string, T>();
  for (const item of items) {
    deduped.set(item.preference.key, item);
  }
  return [...deduped.values()];
}

function toPreferenceKey(text: string, sessionId: string | undefined, entityId: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 48);
  return slug || `${entityId}_${sessionId ?? "default"}_${createId().slice(0, 8)}`;
}

async function consolidatePreferences(
  store: FolderStructuredMemoryStore,
  config: MonoMemoryV2Config,
  entityId: string,
  extracted: Array<{ preference: OtherPreferenceRecord }>,
  evidence: MemoryEvidenceRecord[]
): Promise<OtherPreferencesRecord> {
  const current = await store.getOtherPreferences(entityId);
  const nextItems = new Map(current.items.map((item) => [item.key, item]));

  for (const candidate of extracted) {
    const matchingEvidence = evidence.filter((item) => item.tags.includes(candidate.preference.key));
    const existing = nextItems.get(candidate.preference.key);
    const evidenceIds = [...new Set([...(existing?.evidenceIds ?? []), ...matchingEvidence.map((item) => item.id)])];
    const confidence = Math.min(
      0.99,
      Math.max(candidate.preference.confidence, (existing?.confidence ?? 0)) + Math.min(evidenceIds.length, 4) * 0.03
    );
    if (evidenceIds.length < config.promotion.stablePreferenceOccurrences && candidate.preference.confidence < 0.95) {
      nextItems.set(candidate.preference.key, {
        ...(existing ?? candidate.preference),
        confidence,
        evidenceIds,
        updatedAt: Date.now()
      });
      continue;
    }
    nextItems.set(candidate.preference.key, {
      ...(existing ?? candidate.preference),
      summary: candidate.preference.summary,
      polarity: candidate.preference.polarity,
      confidence,
      evidenceIds,
      updatedAt: Date.now()
    });
  }

  return {
    entityId,
    updatedAt: Date.now(),
    items: [...nextItems.values()].sort((left, right) => right.updatedAt - left.updatedAt)
  };
}

async function consolidateInferences(
  store: FolderStructuredMemoryStore,
  config: MonoMemoryV2Config,
  entityId: string,
  preferences: OtherPreferenceRecord[]
): Promise<OtherInferenceRecord[]> {
  const current = await store.getOtherInferences(entityId);
  const next = new Map(current.map((item) => [item.trait, item]));
  for (const inference of deriveInferencesFromPreferences(preferences, config)) {
    const existing = next.get(inference.trait);
    next.set(inference.trait, {
      ...(existing ?? inference),
      ...inference,
      updatedAt: Date.now(),
      basedOn: [...new Set([...(existing?.basedOn ?? []), ...inference.basedOn])]
    });
  }
  return [...next.values()].sort((left, right) => right.confidence - left.confidence);
}

function deriveInferencesFromPreferences(
  preferences: OtherPreferenceRecord[],
  config: MonoMemoryV2Config
): OtherInferenceRecord[] {
  const items: OtherInferenceRecord[] = [];
  const directness = preferences.find((item) => item.key === "prefers_directness");
  if (directness) {
    items.push({
      id: `inf-${directness.key}`,
      trait: "prefers_directness",
      summary: "Respond better to direct and low-friction answers.",
      confidence: directness.confidence,
      basedOn: directness.evidenceIds,
      decayPolicy: "slow",
      status: directness.evidenceIds.length >= config.promotion.stablePreferenceOccurrences ? "stable" : "reviewed",
      updatedAt: Date.now()
    });
  }

  const lowTolerance = preferences.filter((item) =>
    item.key === "avoid_unsolicited_summaries"
    || item.key === "avoid_unsolicited_reassurance"
    || item.key === "avoid_unsolicited_assumptions"
  );
  if (lowTolerance.length > 0) {
    items.push({
      id: "inf-low_tolerance_for_unsolicited_expansion",
      trait: "low_tolerance_for_unsolicited_expansion",
      summary: "Unsolicited expansion, reassurance, or assumptions tend to reduce response quality.",
      confidence: Math.min(0.98, average(lowTolerance.map((item) => item.confidence)) + 0.05),
      basedOn: [...new Set(lowTolerance.flatMap((item) => item.evidenceIds))],
      decayPolicy: "medium",
      status: lowTolerance.length >= config.promotion.minPatternOccurrences ? "reviewed" : "hypothesis",
      updatedAt: Date.now()
    });
  }
  return items;
}

async function updateRelationshipState(
  store: FolderStructuredMemoryStore,
  entityId: string,
  preferences: OtherPreferenceRecord[]
): Promise<OtherRelationshipStateRecord> {
  const current = await store.getRelationshipState(entityId);
  const recentTensions = [
    ...current.recentTensions,
    ...preferences
      .filter((item) => item.polarity === "avoid")
      .map((item) => item.summary)
  ];
  const collaborationMode = preferences.some((item) => item.key === "prefers_directness")
    ? "direct"
    : current.collaborationMode;
  const trustDelta = preferences.some((item) => item.polarity === "prefer") ? 0.02 : 0;
  return {
    ...current,
    entityId,
    updatedAt: Date.now(),
    collaborationMode,
    trustLevel: Math.min(0.95, current.trustLevel + trustDelta),
    recentTensions: [...new Set(recentTensions)].slice(-5)
  };
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
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
  polarity: OtherPreferenceRecord["polarity"];
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
