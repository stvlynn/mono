import {
  createId,
  type AutonomyIntent,
  type FeedbackSignal,
  type HeartbeatDecision,
  type LearningState,
  type RuntimeCooldownRecord,
  type SelfRuntimeRecord,
  type TaskLease,
  type TaskResult,
  type TaskState,
  type TaskTodoRecord,
} from "@mono/shared";

export interface HeartbeatInputs {
  now: number;
  selfRuntime: SelfRuntimeRecord;
  learningState: LearningState;
  todos: TaskTodoRecord[];
  recentFeedback: FeedbackSignal[];
  recentSessionTexts: string[];
  currentTaskId?: string;
}

export interface HeartbeatSelection {
  decision: HeartbeatDecision;
  selectedIntent?: AutonomyIntent;
}

export type TaskDiagnosisCode =
  | "info_gap"
  | "plan_error"
  | "execution_error"
  | "bad_assumption"
  | "external_constraint";

export interface TaskDiagnosis {
  code: TaskDiagnosisCode;
  summary: string;
  openQuestion: string;
  hypothesis: string;
  cooldownKey: string;
}

const AUTONOMY_PRIORITY_THRESHOLD = 0.55;
const STALLED_TODO_AGE_MS = 30_000;
const MAX_CURRENT_GOALS = 6;
const MAX_FAILURE_PATTERNS = 8;
const MAX_COOLDOWNS = 8;
const AUTONOMY_COOLDOWN_MS = 5 * 60_000;
export const CURIOSITY_COOLDOWN_KEY = "curiosity:global";
export const CURIOSITY_COOLDOWN_MS = 15 * 60_000;

export function createAutonomyLease(now = Date.now()): TaskLease {
  return {
    startedAt: now,
    maxWallTimeMs: 60_000,
    maxToolCalls: 6,
    maxSteps: 8,
  };
}

export function createCuriosityLease(now = Date.now()): TaskLease {
  return {
    startedAt: now,
    maxWallTimeMs: 20_000,
    maxToolCalls: 2,
    maxSteps: 3,
  };
}

export function buildHeartbeatSelection(input: HeartbeatInputs): HeartbeatSelection {
  const autonomyBias = resolveAutonomyBias(input.learningState);
  if (autonomyBias <= -0.35) {
    return createNoopHeartbeatSelection(input.now, "Recent feedback currently discourages autonomous action.");
  }

  const todoCandidates = buildTodoCandidates(input);
  const openQuestionCandidates = buildOpenQuestionCandidates(input);
  const feedbackCandidates = buildFeedbackReflectionCandidate(input);
  const curiosityCandidates = buildCuriosityCandidates(input, {
    todoCandidates,
    openQuestionCandidates,
    feedbackCandidates,
  });
  const candidates = applyAutonomyBias([
    ...todoCandidates,
    ...openQuestionCandidates,
    ...feedbackCandidates,
    ...curiosityCandidates,
  ], autonomyBias)
    .sort((left, right) => right.priority - left.priority || left.goal.localeCompare(right.goal));

  const selectedIntent = candidates[0];
  if (!selectedIntent || selectedIntent.priority < AUTONOMY_PRIORITY_THRESHOLD) {
    return createNoopHeartbeatSelection(
      input.now,
      candidates.length === 0
        ? "No autonomy candidates were eligible."
        : `Top candidate priority ${selectedIntent?.priority.toFixed(2) ?? "0.00"} is below threshold.`,
      candidates,
    );
  }

  if (!input.selfRuntime.autonomyPolicy.allowBroadExecution && selectedIntent.riskLevel !== "low") {
    return createConfirmationHeartbeatSelection(input.now, selectedIntent, candidates);
  }

  return {
    selectedIntent,
    decision: {
      timestamp: input.now,
      decision: selectedIntent.recommendedAction,
      reasons: [
        `Selected ${selectedIntent.kind} with priority ${selectedIntent.priority.toFixed(2)}.`,
        `Risk level is ${selectedIntent.riskLevel}.`,
      ],
      selectedIntentId: selectedIntent.id,
      candidates: candidates.map(toDecisionCandidate),
    },
  };
}

function buildCuriosityCandidates(
  input: HeartbeatInputs,
  existing: {
    todoCandidates: AutonomyIntent[];
    openQuestionCandidates: AutonomyIntent[];
    feedbackCandidates: AutonomyIntent[];
  },
): AutonomyIntent[] {
  if (
    existing.todoCandidates.length > 0
    || existing.openQuestionCandidates.length > 0
    || existing.feedbackCandidates.length > 0
  ) {
    return [];
  }

  if (isCooldownActive(input.now, CURIOSITY_COOLDOWN_KEY, input.selfRuntime.cooldowns, input.learningState.cooldowns)) {
    return [];
  }

  const representedQuestions = new Set(input.selfRuntime.openQuestions.map(normalizeKey));
  const representedHypotheses = new Set(input.selfRuntime.currentHypotheses.map(normalizeKey));
  const seenSeeds = new Set<string>();

  for (const seed of collectCuriositySeeds(input)) {
    if (!isCuriositySeedEligible(seed)) {
      continue;
    }

    const normalizedSeed = normalizeKey(seed.text);
    if (!normalizedSeed || seenSeeds.has(normalizedSeed)) {
      continue;
    }
    seenSeeds.add(normalizedSeed);

    if (representedQuestions.has(normalizedSeed)) {
      continue;
    }
    if (seed.source !== "hypothesis" && representedHypotheses.has(normalizedSeed)) {
      continue;
    }

    return [{
      id: createId(),
      createdAt: input.now,
      kind: "curiosity_probe",
      sourceSignal: "novelty_signal",
      priority: 0.58,
      riskLevel: "low",
      recommendedAction: "enqueue_task",
      status: "pending",
      goal: `Explore one repo question suggested by runtime seed: ${seed.text}. Scan lightly, identify one concrete information gap, propose one hypothesis, record brief evidence, then stop.`,
      evidence: [`Seed: ${seed.text}`],
    } satisfies AutonomyIntent];
  }

  return [];
}

function createNoopHeartbeatSelection(
  timestamp: number,
  reason: string,
  candidates: AutonomyIntent[] = []
): HeartbeatSelection {
  return {
    decision: {
      timestamp,
      decision: "noop",
      reasons: [reason],
      candidates: candidates.map(toDecisionCandidate),
    },
  };
}

function createConfirmationHeartbeatSelection(
  timestamp: number,
  selectedIntent: AutonomyIntent,
  candidates: AutonomyIntent[]
): HeartbeatSelection {
  return {
    selectedIntent: {
      ...selectedIntent,
      recommendedAction: "request_user_confirmation",
    },
    decision: {
      timestamp,
      decision: "request_user_confirmation",
      reasons: [
        `Selected ${selectedIntent.kind} but policy currently disallows autonomous ${selectedIntent.riskLevel}-risk execution.`,
      ],
      selectedIntentId: selectedIntent.id,
      candidates: candidates.map(toDecisionCandidate),
    },
  };
}

function applyAutonomyBias(intents: AutonomyIntent[], autonomyBias: number): AutonomyIntent[] {
  return intents.map((intent) => ({
    ...intent,
    priority: clamp(intent.priority + autonomyBias * 0.2, 0, 1),
  }));
}

export function buildAutonomyExtraContext(intent: AutonomyIntent): string {
  const lines = [
    "This task was created by the autonomy heartbeat.",
    `Intent: ${intent.kind}`,
    `Source signal: ${intent.sourceSignal}`,
    `Priority: ${intent.priority.toFixed(2)}`,
    `Risk: ${intent.riskLevel}`,
    "Act conservatively. Prefer evidence, scoped work, and explicit uncertainty over blind progress.",
  ];

  if (intent.kind === "curiosity_probe") {
    lines.push(
      "This is a curiosity probe, not a user-requested implementation task.",
      "Scan lightly and stop after one concrete question, one hypothesis, and one evidence line.",
      "Use the required tags exactly:",
      "[curiosity-question: ...]",
      "[curiosity-hypothesis: ...]",
      "[curiosity-evidence: ...]",
    );
  }

  return lines.join("\n");
}

export function diagnoseTaskOutcome(task: TaskState, result: TaskResult, options: {
  loopDetected?: boolean;
  leaseExceeded?: boolean;
} = {}): TaskDiagnosis | null {
  const normalizedGoal = task.goal.trim() || "current task";

  if (options.leaseExceeded) {
    return {
      code: "external_constraint",
      summary: "Autonomy lease budget was exhausted before the task reached a stable conclusion.",
      openQuestion: `How should ${normalizedGoal} be resumed within a tighter budget?`,
      hypothesis: "The task likely needs a smaller scope or a cheaper verification path.",
      cooldownKey: `task:${task.taskId}`,
    };
  }

  if (options.loopDetected) {
    return {
      code: "execution_error",
      summary: "The runtime detected a repeated tool or assistant loop.",
      openQuestion: `What execution path would unblock ${normalizedGoal} without repeating the same actions?`,
      hypothesis: "The current execution strategy is repeating without producing new evidence.",
      cooldownKey: `task:${task.taskId}`,
    };
  }

  if (result.status === "blocked") {
    return {
      code: "execution_error",
      summary: "The task is blocked and needs a different execution strategy or stronger evidence.",
      openQuestion: `What changed strategy would unblock ${normalizedGoal}?`,
      hypothesis: "The current tool path is not sufficient for the problem.",
      cooldownKey: `task:${task.taskId}`,
    };
  }

  if (result.verification && result.verification.mode !== "none" && !result.verification.passed) {
    const reason = result.verification.reason ?? "";
    if (/evidence/iu.test(reason)) {
      return {
        code: "info_gap",
        summary: "Verification could not confirm the work because evidence was missing.",
        openQuestion: `What evidence is still missing to verify ${normalizedGoal}?`,
        hypothesis: "The work may be partially complete, but the proof path is incomplete.",
        cooldownKey: `verify:${normalizeKey(normalizedGoal)}`,
      };
    }

    return {
      code: "execution_error",
      summary: "Verification found failing evidence after execution.",
      openQuestion: `What specific execution issue still blocks ${normalizedGoal}?`,
      hypothesis: "The change path still contains an implementation defect or regression.",
      cooldownKey: `verify:${normalizeKey(normalizedGoal)}`,
    };
  }

  if (result.status === "incomplete") {
    return {
      code: "plan_error",
      summary: "The task ended incomplete and likely needs a refined plan or smaller next step.",
      openQuestion: `How should ${normalizedGoal} be broken into a smaller next step?`,
      hypothesis: "The current task scope is broader than the available budget or context.",
      cooldownKey: `task:${task.taskId}`,
    };
  }

  return null;
}

export function buildFeedbackSignals(task: TaskState, result: TaskResult, options: {
  diagnosis?: TaskDiagnosis | null;
  loopDetected?: boolean;
  leaseExceeded?: boolean;
  now?: number;
} = {}): FeedbackSignal[] {
  const createdAt = options.now ?? Date.now();
  const target = normalizeKey(task.goal || task.taskId);
  const signals: FeedbackSignal[] = [];

  signals.push(createFeedbackSignal({
    createdAt,
    source: "task",
    kind:
      result.status === "done"
        ? "task_completed"
        : result.status === "blocked"
          ? "task_blocked"
          : "task_incomplete",
    target,
    valence: result.status === "done" ? "positive" : "negative",
    strength: result.status === "done" ? 0.8 : 0.7,
    summary: result.summary,
    task,
  }));

  if (result.verification?.mode && result.verification.mode !== "none") {
    signals.push(createFeedbackSignal({
      createdAt,
      source: "verify",
      kind: result.verification.passed ? "verification_passed" : "verification_failed",
      target,
      valence: result.verification.passed ? "positive" : "negative",
      strength: result.verification.passed ? 0.6 : 0.75,
      summary: result.verification.reason ?? "Verification updated.",
      task,
    }));
  }

  if (options.loopDetected) {
    signals.push(createFeedbackSignal({
      createdAt,
      source: "task",
      kind: "loop_detected",
      target,
      valence: "negative",
      strength: 0.85,
      summary: "The task entered a repeated tool or response loop.",
      task,
    }));
  }

  if (options.leaseExceeded) {
    signals.push(createFeedbackSignal({
      createdAt,
      source: "heartbeat",
      kind: "budget_exhausted",
      target,
      valence: "negative",
      strength: 0.8,
      summary: "Autonomy lease budget was exhausted.",
      task,
    }));
  }

  if (options.diagnosis) {
    signals.push({
      ...createFeedbackSignal({
        createdAt,
        source: "heartbeat",
        kind: "correction",
        target,
        valence: result.status === "done" ? "positive" : "neutral",
        strength: 0.4,
        summary: options.diagnosis.summary,
        task,
      }),
      metadata: {
        diagnosis: options.diagnosis.code,
        ...(task.origin ? { origin: task.origin } : {}),
      },
    });
  }

  return signals;
}

export function extractUserFeedbackSignals(text: string, now = Date.now()): FeedbackSignal[] {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }

  const negativeMatch = USER_NEGATIVE_FEEDBACK_PATTERNS.find((pattern) => pattern.test(normalized));
  if (negativeMatch) {
    return [createExplicitUserFeedbackSignal("correction", "negative", 0.9, normalized, now)];
  }

  const positiveMatch = USER_POSITIVE_FEEDBACK_PATTERNS.find((pattern) => pattern.test(normalized));
  if (positiveMatch) {
    return [createExplicitUserFeedbackSignal("acceptance", "positive", 0.65, normalized, now)];
  }

  return [];
}

function createFeedbackSignal(input: {
  createdAt: number;
  source: FeedbackSignal["source"];
  kind: FeedbackSignal["kind"];
  target: string;
  valence: FeedbackSignal["valence"];
  strength: number;
  summary: string;
  task: TaskState;
}): FeedbackSignal {
  return {
    id: createId(),
    createdAt: input.createdAt,
    source: input.source,
    kind: input.kind,
    target: input.target,
    valence: input.valence,
    strength: input.strength,
    summary: input.summary,
    metadata: input.task.origin ? { origin: input.task.origin } : undefined,
  };
}

function createExplicitUserFeedbackSignal(
  kind: FeedbackSignal["kind"],
  valence: FeedbackSignal["valence"],
  strength: number,
  text: string,
  createdAt: number
): FeedbackSignal {
  return {
    id: createId(),
    createdAt,
    source: "user",
    kind,
    target: "assistant_behavior",
    valence,
    strength,
    summary: summarizeFeedbackText(text),
    metadata: {
      channel: "explicit_user_feedback",
    },
  };
}

export function applyFeedbackToLearningState(
  current: LearningState,
  signals: FeedbackSignal[],
  task: TaskState,
  diagnosis: TaskDiagnosis | null,
  now: number
): LearningState {
  const strategy = diagnosis
    ? `${task.origin ?? "user"}:${diagnosis.code}`
    : `${task.origin ?? "user"}:task`;
  const successCount = signals.filter((item) => item.valence === "positive").length;
  const failureCount = signals.filter((item) => item.valence === "negative").length;
  const existingStats = new Map(current.strategyStats.map((item) => [item.strategy, item]));
  const existing = existingStats.get(strategy);
  existingStats.set(strategy, {
    strategy,
    successCount: (existing?.successCount ?? 0) + successCount,
    failureCount: (existing?.failureCount ?? 0) + failureCount,
    lastAppliedAt: now,
  });

  const userPreferenceBias = { ...current.userPreferenceBias };
  const biasKey = task.origin && task.origin !== "user" ? "autonomy_execution" : "user_execution";
  const biasDelta = signals.reduce((sum, item) => {
    if (item.valence === "positive") {
      return sum + item.strength * 0.1;
    }
    if (item.valence === "negative") {
      return sum - item.strength * 0.1;
    }
    return sum;
  }, 0);
  userPreferenceBias[biasKey] = clamp((userPreferenceBias[biasKey] ?? 0) + biasDelta, -1, 1);
  const explicitAutonomyDelta = signals.reduce((sum, item) => {
    if (item.source !== "user" || item.target !== "assistant_behavior") {
      return sum;
    }
    if (item.valence === "positive") {
      return sum + item.strength * 0.15;
    }
    if (item.valence === "negative") {
      return sum - item.strength * 0.2;
    }
    return sum;
  }, 0);
  if (explicitAutonomyDelta !== 0) {
    userPreferenceBias.autonomy_execution = clamp(
      (userPreferenceBias.autonomy_execution ?? 0) + explicitAutonomyDelta,
      -1,
      1
    );
  }

  const failurePatterns = uniqueTail([
    ...current.failurePatterns,
    ...signals
      .filter((item) => item.valence === "negative")
      .map((item) => item.summary),
  ], MAX_FAILURE_PATTERNS);

  const cooldowns = task.origin && task.origin !== "user" && diagnosis
    ? mergeCooldowns(current.cooldowns, [{
        key: diagnosis.cooldownKey,
        until: now + AUTONOMY_COOLDOWN_MS,
        reason: diagnosis.summary,
      }])
    : current.cooldowns;

  return {
    updatedAt: now,
    strategyStats: [...existingStats.values()].sort((left, right) => left.strategy.localeCompare(right.strategy)),
    failurePatterns,
    userPreferenceBias,
    cooldowns,
  };
}

export function applyFeedbackToSelfRuntime(
  current: SelfRuntimeRecord,
  signals: FeedbackSignal[],
  diagnosis: TaskDiagnosis | null,
  now: number
): Partial<SelfRuntimeRecord> {
  const negativeSignals = signals.filter((item) => item.valence === "negative");
  return {
    currentGoals: current.currentGoals,
    activeProjects: current.activeProjects,
    currentTensions: uniqueTail([
      ...current.currentTensions,
      ...negativeSignals.map((item) => item.summary),
    ], MAX_CURRENT_GOALS),
    taskHints: current.taskHints,
    openQuestions: diagnosis
      ? uniqueTail([...current.openQuestions, diagnosis.openQuestion], MAX_CURRENT_GOALS)
      : current.openQuestions,
    currentHypotheses: diagnosis
      ? uniqueTail([...current.currentHypotheses, diagnosis.hypothesis], MAX_CURRENT_GOALS)
      : current.currentHypotheses,
    frictionPatterns: uniqueTail([
      ...current.frictionPatterns,
      ...negativeSignals.map((item) => item.summary),
    ], MAX_FAILURE_PATTERNS),
    autonomyPolicy: current.autonomyPolicy,
    cooldowns: diagnosis
      ? mergeCooldowns(current.cooldowns, [{
          key: diagnosis.cooldownKey,
          until: now + AUTONOMY_COOLDOWN_MS,
          reason: diagnosis.summary,
        }])
      : current.cooldowns,
    lastFeedbackAt: now,
  };
}

function buildTodoCandidates(input: HeartbeatInputs): AutonomyIntent[] {
  return input.todos.flatMap((todo) => {
    if (todo.taskId === input.currentTaskId) {
      return [];
    }
    if (todo.status !== "active" && todo.status !== "blocked") {
      return [];
    }

    const blocked = todo.status === "blocked";
    const stale = input.now - todo.updatedAt >= STALLED_TODO_AGE_MS;
    if (!blocked && !stale) {
      return [];
    }

    const cooldownKey = `task:${todo.taskId}`;
    if (isCooldownActive(input.now, cooldownKey, input.selfRuntime.cooldowns, input.learningState.cooldowns)) {
      return [];
    }

    const feedbackBias = feedbackBiasForKey(input.recentFeedback, todo.goal);
    const priority = clamp((blocked ? 0.86 : 0.72) + feedbackBias - 0.24, 0, 1);
    const activeTodo = todo.todos.find((item) => item.status === "in_progress") ?? todo.todos[0];
    return [{
      id: createId(),
      createdAt: input.now,
      kind: "resume_task",
      sourceSignal: "stalled_task",
      priority,
      riskLevel: blocked ? "medium" : "low",
      recommendedAction: "resume_task",
      status: "pending",
      goal: blocked
        ? `Unblock and finish: ${todo.goal}`
        : `Resume and finish: ${todo.goal}`,
      taskId: todo.taskId,
      todoMemoryId: todo.id,
      evidence: [
        activeTodo?.description ?? "",
        todo.summary ?? "",
      ].filter(Boolean),
    } satisfies AutonomyIntent];
  });
}

function buildOpenQuestionCandidates(input: HeartbeatInputs): AutonomyIntent[] {
  return input.selfRuntime.openQuestions.slice(-4).flatMap((question) => {
    const key = `question:${normalizeKey(question)}`;
    if (isCooldownActive(input.now, key, input.selfRuntime.cooldowns, input.learningState.cooldowns)) {
      return [];
    }

    const feedbackBias = feedbackBiasForKey(input.recentFeedback, question);
    const frictionBoost = input.selfRuntime.frictionPatterns.some((item) =>
      hasSharedTerms(item, question)
    ) ? 0.02 : 0;
    return [{
      id: createId(),
      createdAt: input.now,
      kind: "investigate_gap",
      sourceSignal: "open_question",
      priority: clamp(0.7 + feedbackBias + frictionBoost - 0.18, 0, 1),
      riskLevel: "low",
      recommendedAction: "enqueue_task",
      status: "pending",
      goal: `Investigate and resolve: ${question}`,
      evidence: [question],
    } satisfies AutonomyIntent];
  });
}

function buildFeedbackReflectionCandidate(input: HeartbeatInputs): AutonomyIntent[] {
  const negativeSignals = input.recentFeedback.filter((item) => item.valence === "negative");
  if (negativeSignals.length < 2) {
    return [];
  }

  const repeatedSummary = negativeSignals
    .slice(0, 2)
    .map((item) => item.summary)
    .join(" / ");
  const cooldownKey = `feedback:${normalizeKey(repeatedSummary)}`;
  if (isCooldownActive(input.now, cooldownKey, input.selfRuntime.cooldowns, input.learningState.cooldowns)) {
    return [];
  }

  return [{
    id: createId(),
    createdAt: input.now,
    kind: "self_reflection",
    sourceSignal: "feedback_pattern",
    priority: clamp(0.6 + feedbackBiasForKey(input.recentFeedback, repeatedSummary) - 0.12, 0, 1),
    riskLevel: "low",
    recommendedAction: "enqueue_task",
    status: "pending",
    goal: `Review recent repeated failures: ${repeatedSummary}`,
    evidence: negativeSignals.slice(0, 3).map((item) => item.summary),
  }];
}

function collectCuriositySeeds(input: HeartbeatInputs): Array<{
  text: string;
  source: "session" | "hypothesis";
}> {
  return [
    ...input.selfRuntime.currentHypotheses.slice(-4).reverse().map((text) => ({ text, source: "hypothesis" as const })),
    ...input.recentSessionTexts.slice(-8).reverse().map((text) => ({ text, source: "session" as const })),
  ].filter((seed) => seed.text.trim() && !isSelfReferentialCuriosityText(seed.text));
}

function isCuriositySeedEligible(seed: {
  text: string;
  source: "session" | "hypothesis";
}): boolean {
  if (seed.source === "hypothesis") {
    return true;
  }

  return isDiagnosticSessionSeed(seed.text);
}

function toDecisionCandidate(intent: AutonomyIntent): HeartbeatDecision["candidates"][number] {
  return {
    intentId: intent.id,
    kind: intent.kind,
    priority: intent.priority,
    goal: intent.goal,
    riskLevel: intent.riskLevel,
  };
}

function isCooldownActive(
  now: number,
  key: string,
  runtimeCooldowns: RuntimeCooldownRecord[],
  learningCooldowns: RuntimeCooldownRecord[]
): boolean {
  return [...runtimeCooldowns, ...learningCooldowns].some((item) => item.key === key && item.until > now);
}

function feedbackBiasForKey(signals: FeedbackSignal[], key: string): number {
  const matching = signals.filter((item) => item.target === normalizeKey(key) || normalizeKey(item.target) === normalizeKey(key));
  if (matching.length === 0) {
    return 0;
  }
  const aggregate = matching.reduce((sum, item) => {
    if (item.valence === "positive") {
      return sum + item.strength * 0.05;
    }
    if (item.valence === "negative") {
      return sum - item.strength * 0.07;
    }
    return sum;
  }, 0);
  return clamp(aggregate, -0.18, 0.12);
}

function mergeCooldowns(current: RuntimeCooldownRecord[], additions: RuntimeCooldownRecord[]): RuntimeCooldownRecord[] {
  const next = new Map(current.map((item) => [item.key, item]));
  for (const addition of additions) {
    next.set(addition.key, addition);
  }
  return [...next.values()]
    .sort((left, right) => right.until - left.until)
    .slice(0, MAX_COOLDOWNS);
}

function hasSharedTerms(left: string, right: string): boolean {
  const leftTerms = new Set(tokenize(left));
  return tokenize(right).some((item) => leftTerms.has(item));
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/u)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

function isDiagnosticSeedText(text: string): boolean {
  return /\b(why|how|issue|bug|path|behavior|support|handle|difference|inconsistent|runtime|session|channel|tool)\b/iu.test(text)
    || /(为什么|如何|问题|原因|路径|行为|支持|处理|不一致|运行时|会话|通道|工具)/u.test(text)
    || /[?？]/u.test(text);
}

function isImperativeSeedText(text: string): boolean {
  return /^(用|不要|发|把|查|全网找|安装|send|use|find|check|look|list|show)\b/iu.test(text.trim());
}

function isDiagnosticSessionSeed(text: string): boolean {
  if (isImperativeSeedText(text) || isStatusPromptSeed(text)) {
    return false;
  }

  const normalized = text.trim();
  return /`[^`]+`/u.test(normalized)
    || /\/[A-Za-z0-9._/-]+/.test(normalized)
    || /\b(sendSticker|channel_action|write_todos|getUpdates|telegram|sticker|runtime|session|channel|tool|function|api|repo|path)\b/iu.test(normalized)
    || /(为什么|如何|问题|原因|路径|行为|运行时|会话|通道|工具|函数|接口|仓库|代码)/u.test(normalized);
}

function isStatusPromptSeed(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return normalized === "怎么样了"
    || normalized === "继续追查"
    || normalized === "继续查"
    || normalized === "分析进度如何"
    || normalized === "精读如何"
    || normalized === "你不是有agent-browser吗"
    || normalized === "正常运行中。你问的是哪个任务的进度？";
}

function isSelfReferentialCuriosityText(text: string): boolean {
  return text.startsWith("Explore one repo question suggested by runtime seed:")
    || text.includes("[curiosity-question:")
    || text.includes("[curiosity-hypothesis:")
    || text.includes("[curiosity-evidence:");
}

function uniqueTail(items: string[], limit: number): string[] {
  return [...new Set(items.filter(Boolean))].slice(-limit);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gu, "_")
    .replace(/^_+|_+$/gu, "");
}

function resolveAutonomyBias(learningState: LearningState): number {
  return clamp(
    (learningState.userPreferenceBias.autonomy_execution ?? 0) * 0.8
      + (learningState.userPreferenceBias.assistant_behavior ?? 0) * 0.2,
    -1,
    1
  );
}

function summarizeFeedbackText(text: string, limit = 160): string {
  const normalized = text.replace(/\s+/gu, " ").trim();
  if (normalized.length <= limit) {
    return normalized;
  }
  return `${normalized.slice(0, limit - 1)}…`;
}

const USER_NEGATIVE_FEEDBACK_PATTERNS = [
  /\bthat's wrong\b/iu,
  /\bnot what i asked\b/iu,
  /\byou misunderstood\b/iu,
  /\bdon't do that again\b/iu,
  /\bstop doing that\b/iu,
  /不对/iu,
  /错了/iu,
  /不是这个/iu,
  /不是我要的/iu,
  /你理解错/iu,
  /别再这样/iu,
  /不要再这样/iu,
];

const USER_POSITIVE_FEEDBACK_PATTERNS = [
  /\bthat's right\b/iu,
  /\bexactly\b/iu,
  /\bthat's it\b/iu,
  /\blooks good\b/iu,
  /\bthank(s| you)\b/iu,
  /对，就是这个/iu,
  /这样就对了/iu,
  /这次可以/iu,
  /可以了/iu,
  /谢谢/iu,
];
