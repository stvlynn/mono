import type {
  AutonomyIntent,
  EpisodicEventRecord,
  HeartbeatReplyRecord,
  MemoryEvidenceRecord,
  MonoMemoryV2Config,
  OtherConflictRecord,
  OtherInferenceRecord,
  OtherPreferenceRecord,
  StructuredMemoryPackage,
  StructuredMemoryPackageEntry
} from "@mono/shared";
import type { RetrievedContextItem } from "./retrieval-provider.js";
import { FolderStructuredMemoryStore } from "./structured-store.js";

export interface StructuredMemoryRetrievalOptions {
  query: string;
  activeEntityId: string;
  externalItems?: RetrievedContextItem[];
}

export class StructuredMemoryRetrievalPlanner {
  constructor(
    private readonly store: FolderStructuredMemoryStore,
    private readonly config: MonoMemoryV2Config
  ) {}

  async buildPackage(options: StructuredMemoryRetrievalOptions): Promise<StructuredMemoryPackage> {
    const query = options.query.trim();
    const includeAutonomousWork = shouldRecallAutonomousWork(query);
    const [selfIdentity, selfRuntime, projectProfile, otherProfile, otherPreferences, otherInferences, relationshipState, conflicts, episodic] =
      await Promise.all([
        this.store.getSelfIdentity(),
        this.store.getSelfRuntime(),
        this.store.getProjectProfile(),
        this.store.getOtherProfile(options.activeEntityId),
        this.store.getOtherPreferences(options.activeEntityId),
        this.store.getOtherInferences(options.activeEntityId),
        this.store.getRelationshipState(options.activeEntityId),
        this.store.listConflicts({ entityId: options.activeEntityId, limit: 3, status: "unresolved" }),
        this.store.listRecentEpisodic({ entityId: options.activeEntityId, limit: 8 })
      ]);
    const [recentAutonomyIntents, recentHeartbeatReplies] = includeAutonomousWork
      ? await Promise.all([
          this.store.listAutonomyIntents({ limit: 12 }),
          this.store.listHeartbeatReplyRecords({ limit: 12 }),
        ])
      : [[], []] satisfies [AutonomyIntent[], HeartbeatReplyRecord[]];

    const selfGrounded: StructuredMemoryPackageEntry[] = [];
    const otherGrounded: StructuredMemoryPackageEntry[] = [];
    const taskGroundedHints: StructuredMemoryPackageEntry[] = [];

    if (selfIdentity.summary || selfIdentity.mission || selfIdentity.nonNegotiablePrinciples.length > 0) {
      selfGrounded.push({
        scope: "self",
        title: "Self Identity",
        summary: compactLines([
          selfIdentity.summary ?? "",
          selfIdentity.mission ? `Mission: ${selfIdentity.mission}` : "",
          selfIdentity.defaultSocialStance ? `Social stance: ${selfIdentity.defaultSocialStance}` : "",
          selfIdentity.defaultReasoningStance ? `Reasoning stance: ${selfIdentity.defaultReasoningStance}` : "",
          selfIdentity.nonNegotiablePrinciples.length > 0
            ? `Principles: ${selfIdentity.nonNegotiablePrinciples.join("; ")}`
            : ""
        ])
      });
    }

    if (projectProfile.workspaceSummary || projectProfile.durableFacts.length > 0 || projectProfile.collaborationNorms.length > 0) {
      selfGrounded.push({
        scope: "project",
        title: "Project Memory",
        summary: compactLines([
          projectProfile.workspaceSummary,
          projectProfile.durableFacts.length > 0 ? `Facts: ${projectProfile.durableFacts.join("; ")}` : "",
          projectProfile.collaborationNorms.length > 0 ? `Norms: ${projectProfile.collaborationNorms.join("; ")}` : "",
          projectProfile.maintenanceFocus.length > 0 ? `Maintenance focus: ${projectProfile.maintenanceFocus.join("; ")}` : "",
          projectProfile.knownRiskZones.length > 0 ? `Risk zones: ${projectProfile.knownRiskZones.join("; ")}` : "",
          projectProfile.qualityBar ? `Quality bar: ${projectProfile.qualityBar}` : "",
          projectProfile.preferredInterventionOrder.length > 0
            ? `Intervention order: ${projectProfile.preferredInterventionOrder.join(" -> ")}`
            : ""
        ])
      });
    }

    if (
      selfRuntime.currentGoals.length > 0
      || selfRuntime.currentTensions.length > 0
      || selfRuntime.taskHints.length > 0
      || selfRuntime.openQuestions.length > 0
      || selfRuntime.currentHypotheses.length > 0
      || selfRuntime.frictionPatterns.length > 0
    ) {
      taskGroundedHints.push({
        scope: "self",
        title: "Self Runtime",
        summary: compactLines([
          selfRuntime.currentGoals.length > 0 ? `Current goals: ${selfRuntime.currentGoals.join("; ")}` : "",
          selfRuntime.currentTensions.length > 0 ? `Current tensions: ${selfRuntime.currentTensions.join("; ")}` : "",
          selfRuntime.taskHints.length > 0 ? `Task hints: ${selfRuntime.taskHints.join("; ")}` : "",
          selfRuntime.openQuestions.length > 0 ? `Open questions: ${selfRuntime.openQuestions.join("; ")}` : "",
          selfRuntime.currentHypotheses.length > 0 ? `Hypotheses: ${selfRuntime.currentHypotheses.join("; ")}` : "",
          selfRuntime.frictionPatterns.length > 0 ? `Friction patterns: ${selfRuntime.frictionPatterns.join("; ")}` : ""
        ])
      });
    }

    if (Object.keys(otherProfile.knownFacts).length > 0 || otherProfile.communicationNotes.length > 0) {
      otherGrounded.push({
        scope: "other",
        title: `Entity Profile: ${options.activeEntityId}`,
        summary: compactLines([
          renderKnownFacts(otherProfile.knownFacts),
          otherProfile.communicationNotes.length > 0
            ? `Communication: ${otherProfile.communicationNotes.join("; ")}`
            : ""
        ])
      });
    }

    const relevantPreferences = rankPreferences(otherPreferences.items, query).slice(0, 3);
    for (const item of relevantPreferences) {
      otherGrounded.push({
        scope: "other",
        title: `Preference: ${item.key}`,
        summary: `${item.summary} [${item.status}]`,
        confidence: item.confidence,
        evidenceIds: item.evidenceIds
      });
    }

    if (this.config.enableInference) {
      const relevantInferences = rankInferences(otherInferences, query).slice(0, 2);
      for (const item of relevantInferences) {
        otherGrounded.push({
          scope: "other",
          title: `Inference: ${item.trait}`,
          summary: `${item.summary} [${item.status}]`,
          confidence: item.confidence,
          evidenceIds: item.basedOn
        });
      }
    }

    if (relationshipState.collaborationMode !== "default" || relationshipState.recentTensions.length > 0) {
      otherGrounded.push({
        scope: "other",
        title: `Relationship: ${options.activeEntityId}`,
        summary: compactLines([
          `Collaboration mode: ${relationshipState.collaborationMode}`,
          `Trust level: ${relationshipState.trustLevel.toFixed(2)}`,
          relationshipState.recentTensions.length > 0
            ? `Recent tensions: ${relationshipState.recentTensions.join("; ")}`
            : ""
        ])
      });
    }

    const relevantEpisodic = rankEpisodicEvents(episodic, query).slice(0, 2);
    for (const item of relevantEpisodic) {
      taskGroundedHints.push({
        scope: "episodic",
        title: `Recent event: ${new Date(item.createdAt).toISOString()}`,
        summary: item.summary,
        sourceIds: [item.id]
      });
    }

    const autonomousWorkEntry = buildRecentAutonomousWorkEntry(recentAutonomyIntents, recentHeartbeatReplies, query);
    if (autonomousWorkEntry) {
      taskGroundedHints.push(autonomousWorkEntry);
    }

    const evidenceIds = [
      ...new Set([
        ...selfGrounded.flatMap((item) => item.evidenceIds ?? []),
        ...otherGrounded.flatMap((item) => item.evidenceIds ?? []),
        ...taskGroundedHints.flatMap((item) => item.evidenceIds ?? []),
        ...conflicts.flatMap((item) => item.evidenceIds)
      ])
    ];
    const evidence = evidenceIds.length > 0
      ? await this.store.listEvidence({
          entityId: options.activeEntityId,
          ids: evidenceIds,
          limit: this.config.maxEvidencePerPackage
        })
      : [];

    const entries = [...selfGrounded, ...otherGrounded, ...taskGroundedHints];
    return {
      activeEntityId: options.activeEntityId,
      generatedAt: Date.now(),
      selfGrounded,
      otherGrounded,
      taskGroundedHints,
      conflicts,
      entries,
      evidence,
      externalItems: (options.externalItems ?? []).map((item) => ({
        id: item.id,
        title: item.title,
        text: item.text,
        score: item.score
      }))
    };
  }
}

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function rankPreferences(items: OtherPreferenceRecord[], query: string): OtherPreferenceRecord[] {
  const tokens = tokenize(query);
  return [...items].sort((left, right) => preferenceScore(right, tokens) - preferenceScore(left, tokens));
}

function preferenceScore(item: OtherPreferenceRecord, tokens: string[]): number {
  const statusBonus = item.status === "stable" ? 0.2 : item.status === "pattern" ? 0.1 : 0;
  return baseMatchScore(`${item.key} ${item.summary}`, tokens) + item.confidence + statusBonus;
}

function rankInferences(items: OtherInferenceRecord[], query: string): OtherInferenceRecord[] {
  const tokens = tokenize(query);
  return [...items].sort((left, right) => inferenceScore(right, tokens) - inferenceScore(left, tokens));
}

function inferenceScore(item: OtherInferenceRecord, tokens: string[]): number {
  const statusBonus = item.status === "stable" ? 0.2 : item.status === "reviewed" ? 0.1 : 0;
  return baseMatchScore(`${item.trait} ${item.summary}`, tokens) + item.confidence + statusBonus;
}

function rankEpisodicEvents(items: EpisodicEventRecord[], query: string): EpisodicEventRecord[] {
  const tokens = tokenize(query);
  return [...items].sort((left, right) => episodicScore(right, tokens) - episodicScore(left, tokens));
}

function episodicScore(item: EpisodicEventRecord, tokens: string[]): number {
  return baseMatchScore(`${item.queryText} ${item.summary} ${item.messages.join(" ")}`, tokens) + item.salience;
}

function baseMatchScore(text: string, tokens: string[]): number {
  if (tokens.length === 0) {
    return 0;
  }
  const haystack = text.toLowerCase();
  return tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

function shouldRecallAutonomousWork(query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return /\b(heartbeat|autonomy|autonomous|background|behind the scenes|recent work|what were you doing|what have you been doing)\b/iu.test(normalized)
    || /(心跳|后台|后台任务|自动任务|自主任务|最近.*做了什么|刚刚.*干嘛|刚才.*干嘛|你在忙什么|你最近在做什么)/u.test(query);
}

function buildRecentAutonomousWorkEntry(
  intents: AutonomyIntent[],
  replies: HeartbeatReplyRecord[],
  query: string,
): StructuredMemoryPackageEntry | null {
  if (intents.length === 0 && replies.length === 0) {
    return null;
  }

  const rankedIntents = rankAutonomyIntents(intents, replies, query).slice(0, 3);
  if (rankedIntents.length === 0) {
    return null;
  }

  const replyByIntentId = new Map(
    replies
      .filter((item) => item.intentId)
      .map((item) => [item.intentId!, item] as const),
  );
  const summaryLines = rankedIntents.map((intent) => {
    const reply = replyByIntentId.get(intent.id);
    const outcome = reply
      ? ` Outcome: ${reply.status}${reply.reason ? ` (${reply.reason})` : ""}${reply.normalizedText ? ` — ${summarizeText(reply.normalizedText, 100)}` : ""}.`
      : "";
    return `[${intent.kind}/${intent.status}] ${summarizeText(intent.goal, 140)}.${outcome}`;
  });

  return {
    scope: "self",
    title: "Recent Autonomous Work",
    summary: compactLines(summaryLines),
    sourceIds: rankedIntents.map((item) => item.id),
  };
}

function rankAutonomyIntents(
  intents: AutonomyIntent[],
  replies: HeartbeatReplyRecord[],
  query: string,
): AutonomyIntent[] {
  const tokens = tokenize(query);
  const replyByIntentId = new Map(
    replies
      .filter((item) => item.intentId)
      .map((item) => [item.intentId!, item] as const),
  );

  return [...intents].sort((left, right) =>
    autonomyIntentScore(right, tokens, replyByIntentId) - autonomyIntentScore(left, tokens, replyByIntentId)
      || right.createdAt - left.createdAt
  );
}

function autonomyIntentScore(
  intent: AutonomyIntent,
  tokens: string[],
  replyByIntentId: Map<string, HeartbeatReplyRecord>,
): number {
  const reply = replyByIntentId.get(intent.id);
  const recencyBonus = Math.max(0, 1 - ((Date.now() - intent.createdAt) / (2 * 60 * 60_000)));
  return baseMatchScore(
    [
      intent.goal,
      intent.evidence.join(" "),
      reply?.normalizedText ?? "",
      reply?.reason ?? "",
    ].join(" "),
    tokens,
  ) + recencyBonus;
}

function summarizeText(text: string, limit: number): string {
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 1)}…`;
}

function renderKnownFacts(value: Record<string, string>): string {
  const entries = Object.entries(value);
  if (entries.length === 0) {
    return "";
  }
  return `Known facts: ${entries.map(([key, item]) => `${key}=${item}`).join("; ")}`;
}

function compactLines(lines: string[]): string {
  return lines.map((line) => line.trim()).filter(Boolean).join("\n");
}
