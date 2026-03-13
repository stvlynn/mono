import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { appendJsonLine, createId, readJsonFile, readJsonLines, writeJsonFile } from "@mono/shared";
import type {
  EpisodicEventRecord,
  MemoryEvidenceRecord,
  NarrativeUpdateRecord,
  OtherEntityProfileRecord,
  OtherInferenceRecord,
  OtherPreferencesRecord,
  OtherRelationshipStateRecord,
  ProjectMemoryProfileRecord,
  SelfGuidesRecord,
  SelfIdentityRecord,
  SelfRoleRecord,
  SelfTraitRecord,
  SelfValueRecord
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
    return (
      await readJsonFile<OtherPreferencesRecord>(this.otherPreferencesPath(entityId))
    ) ?? defaultOtherPreferencesRecord(entityId);
  }

  async writeOtherPreferences(entityId: string, record: OtherPreferencesRecord): Promise<void> {
    await writeJsonFile(this.otherPreferencesPath(entityId), { ...record, entityId, updatedAt: Date.now() });
  }

  async getOtherInferences(entityId: string): Promise<OtherInferenceRecord[]> {
    return (await readJsonFile<OtherInferenceRecord[]>(this.otherInferencesPath(entityId))) ?? [];
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

  private episodicEventsPath(): string {
    return join(this.episodicDir(), "events.jsonl");
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
