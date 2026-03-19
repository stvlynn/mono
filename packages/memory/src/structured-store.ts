import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { appendJsonLine, createId, readJsonFile, readJsonLines, writeJsonFile } from "@mono/shared";
import type {
  EpisodicEventRecord,
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
    return (
      await readJsonFile<SelfRuntimeRecord>(this.selfRuntimePath())
    ) ?? defaultSelfRuntimeRecord();
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
      lastReflectionAt: patch.lastReflectionAt ?? current.lastReflectionAt
    };
    await writeJsonFile(this.selfRuntimePath(), next);
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
    return (
      await readJsonFile<ProjectMemoryProfileRecord>(this.projectProfilePath())
    ) ?? defaultProjectProfileRecord();
  }

  async upsertProjectProfile(patch: Partial<ProjectMemoryProfileRecord>): Promise<ProjectMemoryProfileRecord> {
    const current = await this.getProjectProfile();
    const next: ProjectMemoryProfileRecord = {
      ...current,
      ...patch,
      updatedAt: Date.now(),
      durableFacts: patch.durableFacts ?? current.durableFacts,
      collaborationNorms: patch.collaborationNorms ?? current.collaborationNorms
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

  async appendEpisodicEvent(record: Omit<EpisodicEventRecord, "id"> & { id?: string }): Promise<EpisodicEventRecord> {
    const next: EpisodicEventRecord = {
      ...record,
      id: record.id ?? createId()
    };
    await appendJsonLine(this.episodicEventsPath(), next);
    return next;
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
    taskHints: []
  };
}

function defaultProjectProfileRecord(): ProjectMemoryProfileRecord {
  return {
    updatedAt: 0,
    workspaceSummary: "",
    durableFacts: [],
    collaborationNorms: []
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
