import type {
  MonoMemoryV2Config,
  OtherConflictRecord,
  OtherInferenceRecord,
  OtherPreferenceRecord,
  OtherRelationshipStateRecord,
  PreferenceObservationRecord,
  SalienceQueueRecord,
  SelfRuntimeRecord,
} from "@mono/shared";
import { FolderStructuredMemoryStore } from "./structured-store.js";

export interface StructuredMemoryConsolidationInput {
  config: MonoMemoryV2Config;
  store: FolderStructuredMemoryStore;
  entityId: string;
}

export interface StructuredMemoryConsolidationResult {
  selfRuntime: SelfRuntimeRecord;
  preferences: { entityId: string; updatedAt: number; items: OtherPreferenceRecord[] };
  inferences: OtherInferenceRecord[];
  relationshipState: OtherRelationshipStateRecord;
  conflicts: OtherConflictRecord[];
  processedQueue: SalienceQueueRecord[];
}

export async function runStructuredMemoryConsolidation(
  input: StructuredMemoryConsolidationInput
): Promise<StructuredMemoryConsolidationResult> {
  await input.store.ensureLayout();
  const [
    currentRuntime,
    currentPreferences,
    currentInferences,
    currentRelationshipState,
    pendingQueue,
  ] = await Promise.all([
    input.store.getSelfRuntime(),
    input.store.getOtherPreferences(input.entityId),
    input.store.getOtherInferences(input.entityId),
    input.store.getRelationshipState(input.entityId),
    input.store.listSalienceQueue({ entityId: input.entityId, status: "pending" })
  ]);

  const preferenceMap = new Map(currentPreferences.items.map((item) => [item.key, item]));
  const conflicts: OtherConflictRecord[] = [];
  const stablePromotions = new Map<string, OtherPreferenceRecord>();

  for (const queueItem of pendingQueue) {
    if (!queueItem.observation) {
      continue;
    }
    const conflict = mergePreferenceObservation(
      preferenceMap,
      queueItem.observation,
      input.config,
      stablePromotions
    );
    if (conflict) {
      conflicts.push(await input.store.appendConflict(input.entityId, conflict));
    }
  }

  const nextPreferences = {
    entityId: input.entityId,
    updatedAt: Date.now(),
    items: [...preferenceMap.values()].sort((left, right) => right.updatedAt - left.updatedAt)
  };
  await input.store.writeOtherPreferences(input.entityId, nextPreferences);

  const nextInferences = input.config.enableInference
    ? reconcileInferences(currentInferences, nextPreferences.items, input.config)
    : [];
  if (input.config.enableInference) {
    await input.store.writeOtherInferences(input.entityId, nextInferences);
  }

  const nextRelationshipState = buildRelationshipState(currentRelationshipState, nextPreferences.items, conflicts);
  await input.store.upsertRelationshipState(input.entityId, nextRelationshipState);

  const nextRuntimePatch = buildNextSelfRuntime(currentRuntime, pendingQueue, nextPreferences.items, conflicts);
  const nextRuntime = await input.store.upsertSelfRuntime(nextRuntimePatch);

  await appendNarrativeUpdates(input.store, pendingQueue, [...stablePromotions.values()], conflicts);
  await refreshCommunicationNotes(input.store, input.entityId, nextPreferences.items, conflicts);
  await markQueueProcessed(input.store, pendingQueue);

  return {
    selfRuntime: nextRuntime,
    preferences: nextPreferences,
    inferences: nextInferences,
    relationshipState: nextRelationshipState,
    conflicts,
    processedQueue: pendingQueue.map((item) => ({
      ...item,
      status: "processed",
      processedAt: Date.now()
    }))
  };
}

function mergePreferenceObservation(
  preferenceMap: Map<string, OtherPreferenceRecord>,
  observation: PreferenceObservationRecord,
  config: MonoMemoryV2Config,
  stablePromotions: Map<string, OtherPreferenceRecord>
): Omit<OtherConflictRecord, "id" | "entityId"> | null {
  const existing = preferenceMap.get(observation.key);
  if (!existing) {
    const created = createPreferenceFromObservation(observation, config);
    preferenceMap.set(observation.key, created);
    if (created.status === "stable") {
      stablePromotions.set(created.key, created);
    }
    return null;
  }

  if (existing.polarity !== observation.polarity) {
    return {
      createdAt: observation.observedAt,
      field: observation.key,
      oldValue: existing.polarity,
      newValue: observation.polarity,
      reason: `Observed conflicting preference signal for ${observation.key}`,
      status: "unresolved",
      evidenceIds: [...new Set([...existing.evidenceIds, ...observation.evidenceIds])]
    };
  }

  const merged = mergeMatchingPreference(existing, observation, config);
  preferenceMap.set(observation.key, merged);
  if (existing.status !== "stable" && merged.status === "stable") {
    stablePromotions.set(merged.key, merged);
  }
  return null;
}

function createPreferenceFromObservation(
  observation: PreferenceObservationRecord,
  config: MonoMemoryV2Config
): OtherPreferenceRecord {
  return {
    key: observation.key,
    summary: observation.summary,
    polarity: observation.polarity,
    confidence: observation.confidence,
    evidenceIds: observation.evidenceIds,
    status: resolvePreferenceStatus(1, config),
    occurrenceCount: 1,
    contexts: [observation.contextKey],
    firstSeenAt: observation.observedAt,
    lastConfirmedAt: observation.observedAt,
    updatedAt: observation.observedAt
  };
}

function mergeMatchingPreference(
  existing: OtherPreferenceRecord,
  observation: PreferenceObservationRecord,
  config: MonoMemoryV2Config
): OtherPreferenceRecord {
  const occurrenceCount = existing.occurrenceCount + 1;
  const contexts = [...new Set([...existing.contexts, observation.contextKey])];
  return {
    ...existing,
    summary: observation.summary,
    confidence: Math.min(0.99, Math.max(existing.confidence, observation.confidence) + Math.min(occurrenceCount, 4) * 0.03),
    evidenceIds: [...new Set([...existing.evidenceIds, ...observation.evidenceIds])],
    status: resolvePreferenceStatus(occurrenceCount, config),
    occurrenceCount,
    contexts,
    lastConfirmedAt: observation.observedAt,
    updatedAt: observation.observedAt
  };
}

function resolvePreferenceStatus(
  occurrenceCount: number,
  config: MonoMemoryV2Config
): OtherPreferenceRecord["status"] {
  if (occurrenceCount >= config.promotion.stablePreferenceOccurrences) {
    return "stable";
  }

  if (occurrenceCount >= config.promotion.minPatternOccurrences) {
    return "pattern";
  }

  return "observation";
}

function reconcileInferences(
  current: OtherInferenceRecord[],
  preferences: OtherPreferenceRecord[],
  config: MonoMemoryV2Config
): OtherInferenceRecord[] {
  const next = new Map(current.map((item) => [item.trait, item]));

  for (const inference of deriveInferencesFromPreferences(preferences, config)) {
    const existing = next.get(inference.trait);
    next.set(inference.trait, {
      ...(existing ?? inference),
      ...inference,
      basedOn: [...new Set([...(existing?.basedOn ?? []), ...inference.basedOn])],
      firstObservedAt: existing?.firstObservedAt ?? inference.firstObservedAt,
      lastReviewedAt: inference.lastReviewedAt,
      updatedAt: inference.updatedAt
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
      status: directness.status === "stable" ? "reviewed" : "hypothesis",
      firstObservedAt: directness.firstSeenAt,
      lastReviewedAt: directness.lastConfirmedAt,
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
      firstObservedAt: Math.min(...lowTolerance.map((item) => item.firstSeenAt)),
      lastReviewedAt: Math.max(...lowTolerance.map((item) => item.lastConfirmedAt)),
      updatedAt: Date.now()
    });
  }

  const briefAnswers = preferences.find((item) => item.key === "prefers_brief_answers");
  if (briefAnswers) {
    items.push({
      id: `inf-${briefAnswers.key}`,
      trait: "prefers_brief_answers",
      summary: "Concise answers are usually preferred unless expansion is requested.",
      confidence: briefAnswers.confidence,
      basedOn: briefAnswers.evidenceIds,
      decayPolicy: "slow",
      status: briefAnswers.status === "stable" ? "reviewed" : "hypothesis",
      firstObservedAt: briefAnswers.firstSeenAt,
      lastReviewedAt: briefAnswers.lastConfirmedAt,
      updatedAt: Date.now()
    });
  }

  return items;
}

function buildRelationshipState(
  current: OtherRelationshipStateRecord,
  preferences: OtherPreferenceRecord[],
  conflicts: OtherConflictRecord[]
): OtherRelationshipStateRecord {
  const recentTensions = [
    ...current.recentTensions,
    ...conflicts.map((item) => item.reason),
    ...preferences.filter((item) => item.polarity === "avoid").map((item) => item.summary)
  ];
  return {
    ...current,
    updatedAt: Date.now(),
    collaborationMode: preferences.some((item) => item.key === "prefers_directness")
      ? "direct"
      : current.collaborationMode,
    trustLevel: Math.max(0.2, Math.min(0.95, current.trustLevel + (conflicts.length === 0 ? 0.02 : -0.02))),
    recentTensions: [...new Set(recentTensions)].slice(-6)
  };
}

function buildNextSelfRuntime(
  current: SelfRuntimeRecord,
  pendingQueue: SalienceQueueRecord[],
  preferences: OtherPreferenceRecord[],
  conflicts: OtherConflictRecord[]
): Partial<SelfRuntimeRecord> {
  const currentGoals = pendingQueue
    .map((item) => item.reason)
    .filter(Boolean);
  const tensionLines = [
    ...current.currentTensions,
    ...conflicts.map((item) => item.reason),
    ...preferences.filter((item) => item.polarity === "avoid").map((item) => item.summary)
  ];
  const taskHints = [
    ...current.taskHints,
    ...preferences
      .filter((item) => item.status !== "observation")
      .map((item) => item.summary)
  ];

  return {
    currentGoals: uniqueTail([...current.currentGoals, ...currentGoals], 6),
    activeProjects: current.activeProjects,
    currentTensions: uniqueTail(tensionLines, 6),
    taskHints: uniqueTail(taskHints, 6),
    lastReflectionAt: conflicts.length > 0 ? Date.now() : current.lastReflectionAt
  };
}

async function appendNarrativeUpdates(
  store: FolderStructuredMemoryStore,
  pendingQueue: SalienceQueueRecord[],
  stablePromotions: OtherPreferenceRecord[],
  conflicts: OtherConflictRecord[]
): Promise<void> {
  for (const item of stablePromotions.slice(0, 2)) {
    await store.appendNarrativeUpdate({
      createdAt: Date.now(),
      event: `Observed stable collaboration preference: ${item.key}`,
      interpretation: `Repeated evidence suggests ${item.summary.toLowerCase()}`,
      carryForwardImplication: `Future responses should account for ${item.key}.`,
      confidenceDelta: 0.05
    });
  }

  for (const conflict of conflicts.slice(0, 2)) {
    await store.appendNarrativeUpdate({
      createdAt: Date.now(),
      eventId: pendingQueue[0]?.eventId,
      event: `Conflict detected for ${conflict.field}`,
      interpretation: conflict.reason,
      carryForwardImplication: "Prefer evidence-backed caution until the conflict resolves.",
      confidenceDelta: -0.03
    });
  }
}

async function refreshCommunicationNotes(
  store: FolderStructuredMemoryStore,
  entityId: string,
  preferences: OtherPreferenceRecord[],
  conflicts: OtherConflictRecord[]
): Promise<void> {
  const currentProfile = await store.getOtherProfile(entityId);
  const communicationNotes = [
    ...currentProfile.communicationNotes,
    ...preferences
      .filter((item) => item.key === "prefers_directness" || item.key === "prefers_brief_answers")
      .map((item) => item.summary),
    ...conflicts.map((item) => `Unresolved preference conflict: ${item.field}`)
  ];
  await store.upsertOtherProfile(entityId, {
    communicationNotes: uniqueTail(communicationNotes, 8)
  });
}

async function markQueueProcessed(
  store: FolderStructuredMemoryStore,
  pendingQueue: SalienceQueueRecord[]
): Promise<void> {
  if (pendingQueue.length === 0) {
    return;
  }

  const allRecords = await store.listSalienceQueue();
  const pendingIds = new Set(pendingQueue.map((item) => item.id));
  await store.replaceSalienceQueue(
    allRecords.map((item) =>
      pendingIds.has(item.id)
      ? { ...item, status: "processed", processedAt: Date.now() }
        : item
    )
  );
}

function uniqueTail(items: string[], limit: number): string[] {
  return [...new Set(items.filter(Boolean))].slice(-limit);
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
