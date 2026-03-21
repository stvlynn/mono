import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { appendJsonLine, createId, readJsonFile, readJsonLines, writeJsonFile } from "@mono/shared";
import type {
  AutonomyIntent,
  EpisodicEventRecord,
  FeedbackSignal,
  HeartbeatDecision,
  HeartbeatReplyRecord,
  LearningState,
  MemoryEvidenceRecord,
  NarrativeUpdateRecord,
  OtherConflictRecord,
  OtherEntityProfileRecord,
  OtherInferenceRecord,
  OtherPreferencesRecord,
  OtherRelationshipStateRecord,
  ProjectMemoryProfileRecord,
  SelfGuidesRecord,
  SelfIdentityRecord,
  SelfRoleRecord,
  SelfRuntimeRecord,
  SelfTraitRecord,
  SelfValueRecord,
  SalienceQueueRecord
} from "@mono/shared";

export class FolderStructuredMemoryStore {
  constructor(readonly root: string) {}

  async ensureLayout(): Promise<void> {
    await Promise.all([
      mkdir(this.selfDir(), { recursive: true }),
      mkdir(this.othersDir(), { recursive: true }),
      mkdir(this.projectDir(), { recursive: true }),
      mkdir(this.episodicDir(), { recursive: true })
    ]);
  }

  async getSelfIdentity(): Promise<SelfIdentityRecord> {
    return (
      await readJsonFile<SelfIdentityRecord>(this.selfIdentityPath())
    ) ?? defaultSelfIdentityRecord();
  }

  async upsertSelfIdentity(patch: Partial<SelfIdentityRecord>): Promise<SelfIdentityRecord> {
    const current = await this.getSelfIdentity();
    const next: SelfIdentityRecord = {
      ...current,
      ...patch,
      updatedAt: Date.now(),
      nonNegotiablePrinciples: patch.nonNegotiablePrinciples ?? current.nonNegotiablePrinciples,
      boundaries: patch.boundaries ?? current.boundaries,
      forbiddenIdentityClaims: patch.forbiddenIdentityClaims ?? current.forbiddenIdentityClaims,
      styleContract: patch.styleContract ?? current.styleContract
    };
    await writeJsonFile(this.selfIdentityPath(), next);
    return next;
  }

  async getSelfValues(): Promise<SelfValueRecord[]> {
    return (await readJsonFile<SelfValueRecord[]>(this.selfValuesPath())) ?? [];
  }

  async writeSelfValues(values: SelfValueRecord[]): Promise<void> {
    await writeJsonFile(this.selfValuesPath(), values);
  }

  async getSelfTraits(): Promise<SelfTraitRecord[]> {
    return (await readJsonFile<SelfTraitRecord[]>(this.selfTraitsPath())) ?? [];
  }

  async writeSelfTraits(traits: SelfTraitRecord[]): Promise<void> {
    await writeJsonFile(this.selfTraitsPath(), traits);
  }

  async getSelfRoles(): Promise<SelfRoleRecord[]> {
    return (await readJsonFile<SelfRoleRecord[]>(this.selfRolesPath())) ?? [];
  }

  async writeSelfRoles(roles: SelfRoleRecord[]): Promise<void> {
    await writeJsonFile(this.selfRolesPath(), roles);
  }

  async getSelfGuides(): Promise<SelfGuidesRecord> {
    return (
      await readJsonFile<SelfGuidesRecord>(this.selfGuidesPath())
    ) ?? defaultSelfGuidesRecord();
  }

  async upsertSelfGuides(patch: Partial<SelfGuidesRecord>): Promise<SelfGuidesRecord> {
    const current = await this.getSelfGuides();
    const next: SelfGuidesRecord = {
      ...current,
      ...patch,
      updatedAt: Date.now(),
      actualSelf: patch.actualSelf ?? current.actualSelf,
      idealSelf: patch.idealSelf ?? current.idealSelf,
      oughtSelf: patch.oughtSelf ?? current.oughtSelf,
      conflictRules: patch.conflictRules ?? current.conflictRules
    };
    await writeJsonFile(this.selfGuidesPath(), next);
    return next;
  }

  async getSelfRuntime(): Promise<SelfRuntimeRecord> {
    const record = await readJsonFile<SelfRuntimeRecord>(this.selfRuntimePath());
    return record ? normalizeSelfRuntimeRecord(record) : defaultSelfRuntimeRecord();
  }

  async upsertSelfRuntime(patch: Partial<SelfRuntimeRecord>): Promise<SelfRuntimeRecord> {
    const current = await this.getSelfRuntime();
    const next: SelfRuntimeRecord = {
      ...current,
      ...patch,
      updatedAt: Date.now(),
      currentGoals: patch.currentGoals ?? current.currentGoals,
      activeProjects: patch.activeProjects ?? current.activeProjects,
      currentTensions: patch.currentTensions ?? current.currentTensions,
      taskHints: patch.taskHints ?? current.taskHints,
      openQuestions: patch.openQuestions ?? current.openQuestions,
      currentHypotheses: patch.currentHypotheses ?? current.currentHypotheses,
      frictionPatterns: patch.frictionPatterns ?? current.frictionPatterns,
      autonomyPolicy: patch.autonomyPolicy ?? current.autonomyPolicy,
      cooldowns: patch.cooldowns ?? current.cooldowns,
      lastReflectionAt: patch.lastReflectionAt ?? current.lastReflectionAt,
      lastHeartbeatAt: patch.lastHeartbeatAt ?? current.lastHeartbeatAt,
      lastFeedbackAt: patch.lastFeedbackAt ?? current.lastFeedbackAt
    };
    await writeJsonFile(this.selfRuntimePath(), next);
    return next;
  }

  async getLearningState(): Promise<LearningState> {
    const record = await readJsonFile<LearningState>(this.learningStatePath());
    return record ? normalizeLearningState(record) : defaultLearningState();
  }

  async upsertLearningState(patch: Partial<LearningState>): Promise<LearningState> {
    const current = await this.getLearningState();
    const next: LearningState = {
      ...current,
      ...patch,
      updatedAt: Date.now(),
      strategyStats: patch.strategyStats ?? current.strategyStats,
      failurePatterns: patch.failurePatterns ?? current.failurePatterns,
      userPreferenceBias: patch.userPreferenceBias ?? current.userPreferenceBias,
      cooldowns: patch.cooldowns ?? current.cooldowns,
      autonomyTopicStats: patch.autonomyTopicStats ?? current.autonomyTopicStats,
    };
    await writeJsonFile(this.learningStatePath(), next);
    return next;
  }

  async appendNarrativeUpdate(record: Omit<NarrativeUpdateRecord, "id"> & { id?: string }): Promise<NarrativeUpdateRecord> {
    const next: NarrativeUpdateRecord = {
      ...record,
      id: record.id ?? createId()
    };
    await appendJsonLine(this.selfNarrativePath(), next);
    return next;
  }

  async listNarrativeUpdates(limit = 10): Promise<NarrativeUpdateRecord[]> {
    const records = await readJsonLines<NarrativeUpdateRecord>(this.selfNarrativePath());
    return records.sort((left, right) => right.createdAt - left.createdAt).slice(0, limit);
  }

  async getProjectProfile(): Promise<ProjectMemoryProfileRecord> {
    const record = await readJsonFile<ProjectMemoryProfileRecord>(this.projectProfilePath());
    return record ? normalizeProjectProfileRecord(record) : defaultProjectProfileRecord();
  }

  async upsertProjectProfile(patch: Partial<ProjectMemoryProfileRecord>): Promise<ProjectMemoryProfileRecord> {
    const current = await this.getProjectProfile();
    const next: ProjectMemoryProfileRecord = {
      ...current,
      ...patch,
      updatedAt: Date.now(),
      durableFacts: patch.durableFacts ?? current.durableFacts,
      collaborationNorms: patch.collaborationNorms ?? current.collaborationNorms,
      maintenanceFocus: patch.maintenanceFocus ?? current.maintenanceFocus,
      knownRiskZones: patch.knownRiskZones ?? current.knownRiskZones,
      preferredInterventionOrder: patch.preferredInterventionOrder ?? current.preferredInterventionOrder
    };
    await writeJsonFile(this.projectProfilePath(), next);
    return next;
  }

  async getOtherProfile(entityId: string): Promise<OtherEntityProfileRecord> {
    return (
      await readJsonFile<OtherEntityProfileRecord>(this.otherProfilePath(entityId))
    ) ?? defaultOtherProfileRecord(entityId);
  }

  async upsertOtherProfile(entityId: string, patch: Partial<OtherEntityProfileRecord>): Promise<OtherEntityProfileRecord> {
    const current = await this.getOtherProfile(entityId);
    const next: OtherEntityProfileRecord = {
      ...current,
      ...patch,
      entityId,
      updatedAt: Date.now(),
      knownFacts: patch.knownFacts ?? current.knownFacts,
      communicationNotes: patch.communicationNotes ?? current.communicationNotes
    };
    await writeJsonFile(this.otherProfilePath(entityId), next);
    return next;
  }

  async getOtherPreferences(entityId: string): Promise<OtherPreferencesRecord> {
    const record = await readJsonFile<OtherPreferencesRecord>(this.otherPreferencesPath(entityId));
    if (!record) {
      return defaultOtherPreferencesRecord(entityId);
    }

    return {
      entityId,
      updatedAt: record.updatedAt ?? 0,
      items: record.items.map((item) => normalizePreferenceRecord(item))
    };
  }

  async writeOtherPreferences(entityId: string, record: OtherPreferencesRecord): Promise<void> {
    await writeJsonFile(this.otherPreferencesPath(entityId), { ...record, entityId, updatedAt: Date.now() });
  }

  async getOtherInferences(entityId: string): Promise<OtherInferenceRecord[]> {
    const records = await readJsonFile<OtherInferenceRecord[]>(this.otherInferencesPath(entityId));
    return (records ?? []).map((item) => normalizeInferenceRecord(item));
  }

  async writeOtherInferences(entityId: string, inferences: OtherInferenceRecord[]): Promise<void> {
    await writeJsonFile(this.otherInferencesPath(entityId), inferences);
  }

  async getRelationshipState(entityId: string): Promise<OtherRelationshipStateRecord> {
    return (
      await readJsonFile<OtherRelationshipStateRecord>(this.otherRelationshipPath(entityId))
    ) ?? defaultRelationshipStateRecord(entityId);
  }

  async upsertRelationshipState(
    entityId: string,
    patch: Partial<OtherRelationshipStateRecord>
  ): Promise<OtherRelationshipStateRecord> {
    const current = await this.getRelationshipState(entityId);
    const next: OtherRelationshipStateRecord = {
      ...current,
      ...patch,
      entityId,
      updatedAt: Date.now(),
      recentTensions: patch.recentTensions ?? current.recentTensions
    };
    await writeJsonFile(this.otherRelationshipPath(entityId), next);
    return next;
  }

  async appendEvidence(entityId: string, record: Omit<MemoryEvidenceRecord, "id" | "entityId"> & { id?: string }): Promise<MemoryEvidenceRecord> {
    const next: MemoryEvidenceRecord = {
      ...record,
      id: record.id ?? createId(),
      entityId
    };
    await appendJsonLine(this.otherEvidencePath(entityId), next);
    return next;
  }

  async listEvidence(options: {
    entityId: string;
    limit?: number;
    ids?: string[];
  }): Promise<MemoryEvidenceRecord[]> {
    const evidence = await readJsonLines<MemoryEvidenceRecord>(this.otherEvidencePath(options.entityId));
    const filtered = options.ids && options.ids.length > 0
      ? evidence.filter((item) => options.ids?.includes(item.id))
      : evidence;
    return filtered
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, options.limit ?? filtered.length);
  }

  async appendConflict(
    entityId: string,
    record: Omit<OtherConflictRecord, "id" | "entityId"> & { id?: string }
  ): Promise<OtherConflictRecord> {
    const next: OtherConflictRecord = {
      ...record,
      id: record.id ?? createId(),
      entityId
    };
    await appendJsonLine(this.otherConflictsPath(entityId), next);
    return next;
  }

  async listConflicts(options: {
    entityId: string;
    limit?: number;
    status?: OtherConflictRecord["status"];
  }): Promise<OtherConflictRecord[]> {
    const conflicts = await readJsonLines<OtherConflictRecord>(this.otherConflictsPath(options.entityId));
    return conflicts
      .filter((item) => options.status ? item.status === options.status : true)
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, options.limit ?? conflicts.length);
  }

  async countConflicts(options: {
    entityId: string;
    status?: OtherConflictRecord["status"];
  }): Promise<number> {
    const conflicts = await readJsonLines<OtherConflictRecord>(this.otherConflictsPath(options.entityId));
    return conflicts.filter((item) => options.status ? item.status === options.status : true).length;
  }

  async appendEpisodicEvent(record: Omit<EpisodicEventRecord, "id"> & { id?: string }): Promise<EpisodicEventRecord> {
    const next: EpisodicEventRecord = {
      ...record,
      origin: record.origin ?? "user_task",
      id: record.id ?? createId()
    };
    await appendJsonLine(this.episodicEventsPath(), next);
    return next;
  }

  async appendAutonomyIntent(record: Omit<AutonomyIntent, "id"> & { id?: string }): Promise<AutonomyIntent> {
    const next: AutonomyIntent = {
      ...record,
      id: record.id ?? createId()
    };
    await appendJsonLine(this.autonomyQueuePath(), next);
    return next;
  }

  async listAutonomyIntents(options: {
    status?: AutonomyIntent["status"];
    limit?: number;
  } = {}): Promise<AutonomyIntent[]> {
    const records = await readJsonLines<AutonomyIntent>(this.autonomyQueuePath());
    return records
      .filter((item) => options.status ? item.status === options.status : true)
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, options.limit ?? records.length);
  }

  async countAutonomyIntents(options: {
    status?: AutonomyIntent["status"];
  } = {}): Promise<number> {
    const records = await readJsonLines<AutonomyIntent>(this.autonomyQueuePath());
    return records.filter((item) => options.status ? item.status === options.status : true).length;
  }

  async replaceAutonomyIntents(records: AutonomyIntent[]): Promise<void> {
    const lines = records.map((record) => JSON.stringify(record)).join("\n");
    await mkdir(this.episodicDir(), { recursive: true });
    await writeFile(this.autonomyQueuePath(), lines ? `${lines}\n` : "", "utf8");
  }

  async updateAutonomyIntent(id: string, patch: Partial<AutonomyIntent>): Promise<AutonomyIntent | null> {
    const records = await this.listAutonomyIntents();
    const current = records.find((item) => item.id === id);
    if (!current) {
      return null;
    }
    const next = { ...current, ...patch };
    await this.replaceAutonomyIntents(records.map((item) => item.id === id ? next : item));
    return next;
  }

  async appendFeedbackSignal(record: Omit<FeedbackSignal, "id"> & { id?: string }): Promise<FeedbackSignal> {
    const next: FeedbackSignal = {
      ...record,
      id: record.id ?? createId()
    };
    await appendJsonLine(this.feedbackLogPath(), next);
    return next;
  }

  async listFeedbackSignals(options: {
    source?: FeedbackSignal["source"];
    kind?: FeedbackSignal["kind"];
    limit?: number;
  } = {}): Promise<FeedbackSignal[]> {
    const records = await readJsonLines<FeedbackSignal>(this.feedbackLogPath());
    return records
      .filter((item) => options.source ? item.source === options.source : true)
      .filter((item) => options.kind ? item.kind === options.kind : true)
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, options.limit ?? records.length);
  }

  async countFeedbackSignals(options: {
    source?: FeedbackSignal["source"];
    kind?: FeedbackSignal["kind"];
  } = {}): Promise<number> {
    const records = await readJsonLines<FeedbackSignal>(this.feedbackLogPath());
    return records
      .filter((item) => options.source ? item.source === options.source : true)
      .filter((item) => options.kind ? item.kind === options.kind : true)
      .length;
  }

  async appendHeartbeatDecision(record: HeartbeatDecision): Promise<HeartbeatDecision> {
    await appendJsonLine(this.heartbeatLogPath(), record);
    return record;
  }

  async listHeartbeatDecisions(limit = 20): Promise<HeartbeatDecision[]> {
    const records = await readJsonLines<HeartbeatDecision>(this.heartbeatLogPath());
    return records
      .sort((left, right) => right.timestamp - left.timestamp)
      .slice(0, limit);
  }

  async countHeartbeatDecisions(): Promise<number> {
    const records = await readJsonLines<HeartbeatDecision>(this.heartbeatLogPath());
    return records.length;
  }

  async appendHeartbeatReplyRecord(record: Omit<HeartbeatReplyRecord, "id"> & { id?: string }): Promise<HeartbeatReplyRecord> {
    const next: HeartbeatReplyRecord = {
      ...record,
      id: record.id ?? createId()
    };
    await appendJsonLine(this.heartbeatRepliesPath(), next);
    return next;
  }

  async listHeartbeatReplyRecords(options: {
    comparisonKey?: string;
    limit?: number;
  } = {}): Promise<HeartbeatReplyRecord[]> {
    const records = await readJsonLines<HeartbeatReplyRecord>(this.heartbeatRepliesPath());
    return records
      .filter((item) => options.comparisonKey ? item.comparisonKey === options.comparisonKey : true)
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, options.limit ?? records.length);
  }

  async countHeartbeatReplyRecords(): Promise<number> {
    const records = await readJsonLines<HeartbeatReplyRecord>(this.heartbeatRepliesPath());
    return records.length;
  }

  async listRecentEpisodic(options: {
    entityId?: string;
    limit?: number;
  } = {}): Promise<EpisodicEventRecord[]> {
    const events = await readJsonLines<EpisodicEventRecord>(this.episodicEventsPath());
    const filtered = options.entityId
      ? events.filter((item) => item.entityId === options.entityId)
      : events;
    return filtered
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, options.limit ?? filtered.length);
  }

  async appendSalienceQueueRecord(record: Omit<SalienceQueueRecord, "id"> & { id?: string }): Promise<SalienceQueueRecord> {
    const next: SalienceQueueRecord = {
      ...record,
      id: record.id ?? createId()
    };
    await appendJsonLine(this.salienceQueuePath(), next);
    return next;
  }

  async listSalienceQueue(options: {
    entityId?: string;
    status?: SalienceQueueRecord["status"];
    limit?: number;
  } = {}): Promise<SalienceQueueRecord[]> {
    const queue = await readJsonLines<SalienceQueueRecord>(this.salienceQueuePath());
    return queue
      .filter((item) => options.entityId ? item.entityId === options.entityId : true)
      .filter((item) => options.status ? item.status === options.status : true)
      .sort((left, right) => left.createdAt - right.createdAt)
      .slice(0, options.limit ?? queue.length);
  }

  async countSalienceQueue(options: {
    entityId?: string;
    status?: SalienceQueueRecord["status"];
  } = {}): Promise<number> {
    const queue = await readJsonLines<SalienceQueueRecord>(this.salienceQueuePath());
    return queue
      .filter((item) => options.entityId ? item.entityId === options.entityId : true)
      .filter((item) => options.status ? item.status === options.status : true)
      .length;
  }

  async replaceSalienceQueue(records: SalienceQueueRecord[]): Promise<void> {
    const lines = records.map((record) => JSON.stringify(record)).join("\n");
    await mkdir(this.episodicDir(), { recursive: true });
    await writeFile(this.salienceQueuePath(), lines ? `${lines}\n` : "", "utf8");
  }

  private selfDir(): string {
    return join(this.root, "self");
  }

  private othersDir(): string {
    return join(this.root, "others");
  }

  private projectDir(): string {
    return join(this.root, "project");
  }

  private episodicDir(): string {
    return join(this.root, "episodic");
  }

  private selfIdentityPath(): string {
    return join(this.selfDir(), "identity.json");
  }

  private selfValuesPath(): string {
    return join(this.selfDir(), "values.json");
  }

  private selfTraitsPath(): string {
    return join(this.selfDir(), "traits.json");
  }

  private selfRolesPath(): string {
    return join(this.selfDir(), "roles.json");
  }

  private selfGuidesPath(): string {
    return join(this.selfDir(), "guides.json");
  }

  private selfRuntimePath(): string {
    return join(this.selfDir(), "runtime.json");
  }

  private learningStatePath(): string {
    return join(this.selfDir(), "learning_state.json");
  }

  private selfNarrativePath(): string {
    return join(this.selfDir(), "narrative.jsonl");
  }

  private projectProfilePath(): string {
    return join(this.projectDir(), "workspace_profile.json");
  }

  private otherProfilePath(entityId: string): string {
    return join(this.othersDir(), entityId, "profile.json");
  }

  private otherPreferencesPath(entityId: string): string {
    return join(this.othersDir(), entityId, "preferences.json");
  }

  private otherInferencesPath(entityId: string): string {
    return join(this.othersDir(), entityId, "inferred_traits.json");
  }

  private otherRelationshipPath(entityId: string): string {
    return join(this.othersDir(), entityId, "relationship_state.json");
  }

  private otherEvidencePath(entityId: string): string {
    return join(this.othersDir(), entityId, "evidence.jsonl");
  }

  private otherConflictsPath(entityId: string): string {
    return join(this.othersDir(), entityId, "conflicts.jsonl");
  }

  private episodicEventsPath(): string {
    return join(this.episodicDir(), "events.jsonl");
  }

  private salienceQueuePath(): string {
    return join(this.episodicDir(), "salience_queue.jsonl");
  }

  private autonomyQueuePath(): string {
    return join(this.episodicDir(), "autonomy_queue.jsonl");
  }

  private feedbackLogPath(): string {
    return join(this.episodicDir(), "feedback_log.jsonl");
  }

  private heartbeatLogPath(): string {
    return join(this.episodicDir(), "heartbeat_log.jsonl");
  }

  private heartbeatRepliesPath(): string {
    return join(this.episodicDir(), "heartbeat_replies.jsonl");
  }
}

function defaultSelfIdentityRecord(): SelfIdentityRecord {
  return {
    updatedAt: 0,
    nonNegotiablePrinciples: [],
    boundaries: [],
    forbiddenIdentityClaims: [],
    styleContract: []
  };
}

function defaultSelfGuidesRecord(): SelfGuidesRecord {
  return {
    updatedAt: 0,
    actualSelf: {
      strengths: [],
      limitations: []
    },
    idealSelf: {
      aspirations: []
    },
    oughtSelf: {
      duties: []
    },
    conflictRules: []
  };
}

function defaultSelfRuntimeRecord(): SelfRuntimeRecord {
  return {
    updatedAt: 0,
    currentGoals: [],
    activeProjects: [],
    currentTensions: [],
    taskHints: [],
    openQuestions: [],
    currentHypotheses: [],
    frictionPatterns: [],
    autonomyPolicy: {
      enabled: true,
      heartbeatIntervalMs: 30_000,
      maxAutonomousTasksPerHour: 6,
      allowBroadExecution: true,
      isolatedSession: true
    },
    cooldowns: []
  };
}

function normalizeSelfRuntimeRecord(record: SelfRuntimeRecord): SelfRuntimeRecord {
  const defaults = defaultSelfRuntimeRecord();
  return {
    ...defaults,
    ...record,
    currentGoals: record.currentGoals ?? defaults.currentGoals,
    activeProjects: record.activeProjects ?? defaults.activeProjects,
    currentTensions: record.currentTensions ?? defaults.currentTensions,
    taskHints: record.taskHints ?? defaults.taskHints,
    openQuestions: record.openQuestions ?? defaults.openQuestions,
    currentHypotheses: record.currentHypotheses ?? defaults.currentHypotheses,
    frictionPatterns: record.frictionPatterns ?? defaults.frictionPatterns,
    autonomyPolicy: {
      ...defaults.autonomyPolicy,
      ...(record.autonomyPolicy ?? {}),
    },
    cooldowns: record.cooldowns ?? defaults.cooldowns,
  };
}

function defaultLearningState(): LearningState {
  return {
    updatedAt: 0,
    strategyStats: [],
    failurePatterns: [],
    userPreferenceBias: {},
    cooldowns: [],
    autonomyTopicStats: [],
  };
}

function normalizeLearningState(record: LearningState): LearningState {
  const defaults = defaultLearningState();
  return {
    ...defaults,
    ...record,
    strategyStats: record.strategyStats ?? defaults.strategyStats,
    failurePatterns: record.failurePatterns ?? defaults.failurePatterns,
    userPreferenceBias: record.userPreferenceBias ?? defaults.userPreferenceBias,
    cooldowns: record.cooldowns ?? defaults.cooldowns,
    autonomyTopicStats: record.autonomyTopicStats ?? defaults.autonomyTopicStats,
  };
}

function defaultProjectProfileRecord(): ProjectMemoryProfileRecord {
  return {
    updatedAt: 0,
    workspaceSummary: "",
    durableFacts: [],
    collaborationNorms: [],
    maintenanceFocus: [],
    knownRiskZones: [],
    preferredInterventionOrder: []
  };
}

function normalizeProjectProfileRecord(record: ProjectMemoryProfileRecord): ProjectMemoryProfileRecord {
  const defaults = defaultProjectProfileRecord();
  return {
    ...defaults,
    ...record,
    durableFacts: record.durableFacts ?? defaults.durableFacts,
    collaborationNorms: record.collaborationNorms ?? defaults.collaborationNorms,
    maintenanceFocus: record.maintenanceFocus ?? defaults.maintenanceFocus,
    knownRiskZones: record.knownRiskZones ?? defaults.knownRiskZones,
    preferredInterventionOrder: record.preferredInterventionOrder ?? defaults.preferredInterventionOrder,
  };
}

function defaultOtherProfileRecord(entityId: string): OtherEntityProfileRecord {
  return {
    entityId,
    updatedAt: 0,
    knownFacts: {},
    communicationNotes: []
  };
}

function defaultOtherPreferencesRecord(entityId: string): OtherPreferencesRecord {
  return {
    entityId,
    updatedAt: 0,
    items: []
  };
}

function defaultRelationshipStateRecord(entityId: string): OtherRelationshipStateRecord {
  return {
    entityId,
    updatedAt: 0,
    trustLevel: 0.5,
    collaborationMode: "default",
    recentTensions: []
  };
}

function normalizePreferenceRecord(record: OtherPreferencesRecord["items"][number]): OtherPreferencesRecord["items"][number] {
  const firstSeenAt = record.firstSeenAt ?? record.updatedAt ?? 0;
  const lastConfirmedAt = record.lastConfirmedAt ?? record.updatedAt ?? firstSeenAt;
  const occurrenceCount = record.occurrenceCount ?? Math.max(record.evidenceIds.length, 1);
  return {
    ...record,
    status: record.status ?? (occurrenceCount >= 2 ? "stable" : "observation"),
    occurrenceCount,
    contexts: record.contexts ?? [],
    firstSeenAt,
    lastConfirmedAt,
    updatedAt: record.updatedAt ?? lastConfirmedAt
  };
}

function normalizeInferenceRecord(record: OtherInferenceRecord): OtherInferenceRecord {
  const firstObservedAt = record.firstObservedAt ?? record.updatedAt ?? 0;
  const lastReviewedAt = record.lastReviewedAt ?? record.updatedAt ?? firstObservedAt;
  return {
    ...record,
    firstObservedAt,
    lastReviewedAt,
    updatedAt: record.updatedAt ?? lastReviewedAt
  };
}
