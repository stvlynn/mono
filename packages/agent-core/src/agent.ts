import {
  type ApprovalPolicy,
  type ApprovalRequest,
  type AutonomyIntent,
  type ChannelCapabilityContext,
  type ChannelCapabilityProvider,
  type RuntimeEvent,
  type ContextAssemblyReport,
  type ConversationMessage,
  type FeedbackSignal,
  type HeartbeatDecision,
  hasTaskInputContent,
  type LearningState,
  type MemoryRecallPlan,
  type MemoryRecord,
  type MemorySearchMatch,
  type MonoConfigSummary,
  type OtherConflictRecord,
  type ResolvedMonoConfig,
  type SessionNodeSummary,
  type SessionSummary,
  type SalienceQueueRecord,
  type ThreadSummary,
  type StructuredMemoryPackage,
  type SelfRuntimeRecord,
  createId,
  readJsonFile,
  mergeTelegramAllowFrom,
  type SandboxMode,
  supportsImageAttachments,
  type TaskInput,
  type TaskLease,
  type TaskOrigin,
  type TaskResult,
  type TaskState,
  type TaskTodoRecord,
  taskInputToPlainText,
  taskInputToUserMessage,
  type ThinkingLevel,
  type ToolExecutionChannel,
  type UnifiedModel,
  userContentToPlainText,
  type UserMessage,
  type VerificationMode
} from "@mono/shared";
import { MonoConfigStore } from "@mono/config";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ModelRegistry, runConversation, type LoadedProfile } from "@mono/llm";
import {
  DeterministicMemoryCompactor,
  FolderMemoryStore,
  FolderStructuredMemoryStore,
  FolderTaskTodoStore,
  LocalMemoryRetrievalProvider,
  StructuredMemoryRetrievalPlanner,
  buildMemoryRecordMetadata,
  createMemoryId,
  persistStructuredMemoryTurn,
  renderMemoryContext,
  renderStructuredMemoryPackage,
  resolvePrimaryEntityId,
  runStructuredMemoryConsolidation,
  selectMemoryIdsByKeyword,
  selectMemoryIdsBySession,
  type MemoryRetrievalProvider,
  type RetrievedContextItem,
  type RetrievedContext,
  type MemoryStore
} from "@mono/memory";
import { SessionManager } from "@mono/session";
import {
  createProtectedBashTool,
  createProtectedCodingTools,
  createChannelActionTool,
  createChannelStoreTool,
  createReadTool,
  DefaultPermissionPolicy,
  wrapToolWithPermissions,
} from "@mono/tools";
import {
  buildDetailedTrace,
  collapseRecallAccumulator,
  createRecallAccumulator,
  emptyRecallPlan,
  mergeRecallPlan,
  projectKeyFromCwd,
  resolveTaskTodoStorePath,
  resolveMemoryStorePath,
  createTaskTodoRecord,
  type RecallAccumulator
} from "./memory-runtime.js";
import { assemblePromptContext } from "./context-assembly.js";
import { loadAvailableSkills, renderSkillsContext } from "./skills.js";
import {
  advanceTaskPhase,
  applyVerificationMode,
  buildTaskContext,
  buildTaskSummary,
  buildTaskTurnPlan,
  compressConversation,
  createTaskState,
  shouldCompressMessages,
  updateTaskAfterTurn
} from "./task-runtime.js";
import {
  autonomyTextsShareTopic,
  applyFeedbackToLearningState,
  applyFeedbackToSelfRuntime,
  buildAutonomyExtraContext,
  buildFeedbackSignals,
  buildHeartbeatSelection,
  createAutonomyLease,
  createCuriosityLease,
  CURIOSITY_COOLDOWN_KEY,
  CURIOSITY_COOLDOWN_MS,
  diagnoseTaskOutcome,
  extractUserFeedbackSignals,
} from "./autonomy-runtime.js";
import {
  buildHeartbeatReplyComparisonKey,
  buildHeartbeatReplyRecord,
  evaluateHeartbeatReply,
  extractCuriosityReplyFields,
  type HeartbeatReplyEvaluation
} from "./heartbeat-response.js";
import { HeartbeatWakeController, type HeartbeatWakeTrigger } from "./heartbeat-wake.js";
import { guardMessagesBeforeSessionPersist } from "./session-tool-result-guard.js";
import { createWriteTodosTool } from "./task-todo-tool.js";
import { defaultPromptRenderer } from "@mono/prompts";

interface TaskRunContext {
  runId: number;
  controller: AbortController;
  session: SessionManager;
  model: UnifiedModel;
  interactionMode: "default" | "channel_chat" | "curiosity";
  channel?: ToolExecutionChannel;
  input: TaskInput;
  extraTaskContext?: string;
  channelContext?: ChannelCapabilityContext | null;
  channelActionRequirement?: {
    nativeActionRequired: boolean;
    action?: string;
    reason?: string;
    textOnlyFallbackAllowed: boolean;
  };
  channelActionFeedback?: string;
  userMessage: UserMessage;
  taskMessages: ConversationMessage[];
  recallAccumulator: RecallAccumulator;
  taskTodoRecord: TaskTodoRecord | null;
  taskTodosDirty: boolean;
  allowedToolNames?: string[];
  sandboxMode: SandboxMode;
  approvalPolicy: ApprovalPolicy;
  origin: TaskOrigin;
  autonomyIntent?: AutonomyIntent;
  lease?: TaskLease;
  heartbeatReplyEvaluation?: HeartbeatReplyEvaluation;
}

export interface RunTaskOptions {
  channel?: ToolExecutionChannel;
  interactionMode?: "default" | "channel_chat" | "curiosity";
  extraTaskContext?: string;
  sandboxMode?: SandboxMode;
  approvalPolicy?: ApprovalPolicy;
  origin?: TaskOrigin;
  autonomyIntent?: AutonomyIntent;
  lease?: TaskLease;
}

export interface AgentOptions {
  cwd?: string;
  model?: string;
  profile?: string;
  baseURL?: string;
  heartbeatEnabled?: boolean;
  thinkingLevel?: ThinkingLevel;
  maxSteps?: number;
  maxTurns?: number;
  verificationMode?: VerificationMode;
  autoApprove?: boolean;
  sandboxMode?: SandboxMode;
  approvalPolicy?: ApprovalPolicy;
  continueSession?: boolean;
  requestApproval?: (request: ApprovalRequest) => Promise<boolean>;
  channelCapabilityProvider?: ChannelCapabilityProvider;
}

export interface AgentState {
  cwd: string;
  profileName: string;
  model: UnifiedModel;
  messages: ConversationMessage[];
  thinkingLevel: ThinkingLevel;
  session: SessionManager;
  config: ResolvedMonoConfig;
  configSummary: MonoConfigSummary;
  memoryStore: MemoryStore;
  taskTodoStore: FolderTaskTodoStore;
  structuredMemoryStore: FolderStructuredMemoryStore;
  sessionLoadedAt: number;
  latestContextReport?: ContextAssemblyReport;
  currentTask?: TaskState;
  currentTodoRecord?: TaskTodoRecord;
  latestHeartbeatDecision?: {
    timestamp: number;
    decision: string;
  };
}

export interface ConfiguredModelProfile {
  name: string;
  model: UnifiedModel;
}

interface TelegramAllowFromStoreFile {
  version?: number;
  allowFrom?: string[];
}

interface HeartbeatRuntimeState {
  selfRuntime: SelfRuntimeRecord;
  learningState: LearningState;
  todos: TaskTodoRecord[];
  recentFeedback: FeedbackSignal[];
  recentIntents: AutonomyIntent[];
  recentSessionTexts: string[];
}

interface TransientTaskStateSnapshot {
  session: SessionManager;
  messages: ConversationMessage[];
  sessionLoadedAt: number;
  latestContextReport?: ContextAssemblyReport;
  currentTask?: TaskState;
  currentTodoRecord?: TaskTodoRecord;
}

interface HeartbeatTaskExecution {
  result: TaskResult;
  sessionId: string;
  filePath: string;
  isolatedSession: boolean;
  heartbeatReplyEvaluation?: HeartbeatReplyEvaluation;
}

interface TaskRunExecution {
  result: TaskResult;
  heartbeatReplyEvaluation?: HeartbeatReplyEvaluation;
}

async function loadOpenVikingAdapter(): Promise<{
  OpenVikingRetrievalProvider: new (...args: any[]) => MemoryRetrievalProvider;
  OpenVikingShadowExporter: new (...args: any[]) => {
    exportRecord(record: MemoryRecord): Promise<unknown>;
  };
  OpenVikingStructuredShadowExporter: new (...args: any[]) => {
    exportRecord(record: { id: string; scope: string; title: string; summary: string; detailLines?: string[] }): Promise<unknown>;
  };
}> {
  const distUrl = new URL("../../openviking-adapter/dist/index.js", import.meta.url);
  if (existsSync(fileURLToPath(distUrl))) {
    return import(distUrl.href);
  }

  const srcUrl = new URL("../../openviking-adapter/src/index.ts", import.meta.url);
  return import(srcUrl.href);
}

async function loadSeekDbAdapter(): Promise<{
  SeekDbExecutionMemoryBackend: new (...args: any[]) => {
    append(record: MemoryRecord): Promise<void>;
  };
  SeekDbRetrievalProvider: new (...args: any[]) => MemoryRetrievalProvider;
  SeekDbSessionMirror: new (...args: any[]) => {
    mirrorSession(input: { sessionId: string; cwd: string; headId?: string; entries: unknown[] }): Promise<unknown>;
  };
}> {
  const distUrl = new URL("../../seekdb-adapter/dist/index.js", import.meta.url);
  if (existsSync(fileURLToPath(distUrl))) {
    return import(distUrl.href);
  }

  const srcUrl = new URL("../../seekdb-adapter/src/index.ts", import.meta.url);
  return import(srcUrl.href);
}

function assertOpenVikingConfig(config: ResolvedMonoConfig["memory"]["openViking"]): void {
  if (!config.enabled || !config.url) {
    throw new Error("OpenViking retrieval requires mono.memory.openViking.enabled=true and mono.memory.openViking.url.");
  }
}

function assertSeekDbConfig(config: ResolvedMonoConfig["memory"]["seekDb"]): void {
  if (!config.enabled) {
    throw new Error("SeekDB retrieval requires mono.memory.seekDb.enabled=true.");
  }
  if (config.mode === "mysql" && !config.database) {
    throw new Error("SeekDB MySQL mode requires mono.memory.seekDb.database to be configured.");
  }
  if (config.mode === "python-embedded" && !config.embeddedPath) {
    throw new Error("SeekDB python-embedded mode requires mono.memory.seekDb.embeddedPath to be configured.");
  }
}

function normalizeSandboxMode(value: SandboxMode | undefined): SandboxMode | undefined {
  if (!value) {
    return undefined;
  }

  if (value === "read-only" || value === "danger-full-access") {
    return value;
  }

  if (value === "workspace-write") {
    throw new Error("Sandbox mode workspace-write is not implemented yet.");
  }

  throw new Error(`Unknown sandbox mode: ${value}`);
}

function normalizeApprovalPolicy(value: ApprovalPolicy | undefined): ApprovalPolicy | undefined {
  if (!value) {
    return undefined;
  }

  if (value === "on-request" || value === "never" || value === "auto-approve") {
    return value;
  }

  throw new Error(`Unknown approval policy: ${value}`);
}

function isForegroundTask(task: TaskState | undefined): boolean {
  return !task || task.origin === undefined || task.origin === "user";
}

export class Agent {
  private readonly cwd: string;
  private readonly registry: ModelRegistry;
  private readonly listeners = new Set<(event: RuntimeEvent) => void>();
  private readonly maxSteps: number;
  private readonly maxTurns: number;
  private readonly autoApprove: boolean;
  private readonly approvalPolicyOverride?: ApprovalPolicy;
  private readonly sandboxModeOverride?: SandboxMode;
  private readonly verificationMode?: VerificationMode;
  private requestApprovalHandler?: (request: ApprovalRequest) => Promise<boolean>;
  private channelCapabilityProvider?: ChannelCapabilityProvider;
  private initialized = false;
  private registryLoaded = false;
  private modelSelection?: string;
  private profileSelection?: string;
  private baseURLOverride?: string;
  private readonly heartbeatEnabled: boolean;
  private continueSession: boolean;
  private disposed = false;
  private requestedThinkingLevel: ThinkingLevel;
  private activeRun?: { id: number; controller: AbortController };
  private nextRunId = 1;
  private readonly memoryCompactor = new DeterministicMemoryCompactor();
  private lastAutonomyRunAt = 0;
  private readonly heartbeatWake = new HeartbeatWakeController<{ intent?: AutonomyIntent }>({
    onError: (error) => this.handleHeartbeatFailure(error),
  });

  state!: AgentState;

  constructor(options: AgentOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.registry = new ModelRegistry({ cwd: this.cwd });
    this.maxSteps = options.maxSteps ?? 8;
    this.maxTurns = options.maxTurns ?? 3;
    this.verificationMode = options.verificationMode;
    this.autoApprove = options.autoApprove ?? false;
    this.approvalPolicyOverride = normalizeApprovalPolicy(options.approvalPolicy);
    this.sandboxModeOverride = normalizeSandboxMode(options.sandboxMode);
    this.requestApprovalHandler = options.requestApproval;
    this.channelCapabilityProvider = options.channelCapabilityProvider;
    this.modelSelection = options.model;
    this.profileSelection = options.profile;
    this.baseURLOverride = options.baseURL;
    this.heartbeatEnabled = options.heartbeatEnabled ?? true;
    this.continueSession = options.continueSession ?? false;
    this.requestedThinkingLevel = options.thinkingLevel ?? "medium";
    this.state = {} as AgentState;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.ensureRegistryLoaded();
    const config = await this.registry.resolveConfig(this.modelSelection, this.profileSelection, this.baseURLOverride);
    const model = config.model;
    const configSummary = await this.registry.getConfigSummary();
    const latestSession = this.continueSession ? await SessionManager.latestForCwd(this.cwd) : undefined;
    const session = new SessionManager({
      cwd: this.cwd,
      sessionId: latestSession?.sessionId,
      sessionsDir: latestSession ? SessionManager.rootDirFromSessionFile(latestSession.filePath) : undefined
    });
    await session.initialize(model);
    const messages = this.continueSession ? await session.loadMessages() : [];
    const memoryStore = new FolderMemoryStore(resolveMemoryStorePath(this.cwd, config.memory.storePath));
    const structuredMemoryStore = new FolderStructuredMemoryStore(resolveMemoryStorePath(this.cwd, config.memory.v2.storePath));
    const taskTodoStore = new FolderTaskTodoStore(resolveTaskTodoStorePath(this.cwd, config.memory.storePath));
    await structuredMemoryStore.ensureLayout();
    this.state = {
      cwd: this.cwd,
      profileName: config.profileName,
      model,
      messages,
      thinkingLevel: this.requestedThinkingLevel,
      session,
      config,
      configSummary,
      memoryStore,
      structuredMemoryStore,
      taskTodoStore,
      sessionLoadedAt: Date.now()
    };
    await this.seedStructuredMemoryStore();
    this.state.currentTask = await this.loadCurrentTaskForHead(session);
    this.state.currentTodoRecord = this.state.currentTask?.currentTodoMemoryId
      ? (await taskTodoStore.get(this.state.currentTask.currentTodoMemoryId)) ?? undefined
      : undefined;
    this.initialized = true;
    this.ensureHeartbeatLoop();
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setRequestApproval(handler: (request: ApprovalRequest) => Promise<boolean>): void {
    this.requestApprovalHandler = handler;
  }

  setChannelCapabilityProvider(provider?: ChannelCapabilityProvider): void {
    this.channelCapabilityProvider = provider;
  }

  async prompt(input: string | TaskInput, options: RunTaskOptions = {}): Promise<ConversationMessage[]> {
    const result = await this.runTask(input, options);
    return result.messages;
  }

  async runTask(input: string | TaskInput, options: RunTaskOptions = {}): Promise<TaskResult> {
    const execution = await this.runTaskDetailed(input, options);
    return execution.result;
  }

  private async runTaskDetailed(input: string | TaskInput, options: RunTaskOptions = {}): Promise<TaskRunExecution> {
    await this.initialize();
    this.state.messages = await this.state.session.loadMessages();
    if (!hasTaskInputContent(input)) {
      throw new Error("Task input requires text or at least one image attachment");
    }

    const normalizedInput = typeof input === "string" ? { text: input } satisfies TaskInput : input;
    if ((normalizedInput.attachments?.length ?? 0) > 0 && !supportsImageAttachments(this.state.model)) {
      throw new Error(`Model ${this.state.model.provider}/${this.state.model.modelId} does not support image attachments`);
    }

    const runContext = this.createTaskRunContext(normalizedInput, options);
    const goal = taskInputToPlainText(normalizedInput);

    try {
      await this.beginTaskRun(runContext);

      let task = createTaskState({
        goal,
        model: runContext.model,
        existingMessages: this.state.messages,
        maxTurns: this.maxTurns,
        origin: runContext.origin,
        parentIntentId: runContext.autonomyIntent?.id,
        lease: runContext.lease
      });
      task = this.applyRunMode(task, runContext);
      const existingTodoRecord = await this.state.taskTodoStore.get(task.taskId);
      if (existingTodoRecord) {
        task.currentTodoMemoryId = existingTodoRecord.id;
      }
      runContext.taskTodoRecord = existingTodoRecord;
      this.state.currentTodoRecord = existingTodoRecord ?? undefined;
      await this.startTaskLifecycle(runContext.runId, runContext.session, task);

      let loopDetected = false;
      let leaseExceeded = false;

      for (let attempt = 0; attempt < this.maxTurns; attempt += 1) {
        if (!this.isRunCurrent(runContext.runId)) {
          return { result: this.buildAbortedTaskResult(runContext.taskMessages) };
        }

        await this.compressSessionIfNeeded(runContext);
        let newMessages: ConversationMessage[];
        try {
          newMessages = await this.runTaskTurn(runContext, task);
        } catch (error: unknown) {
          const err = error instanceof Error ? error : new Error(String(error));
          const phaseLabel = `[phase:${task.phase}]`;
          const wrappedError = new Error(`${phaseLabel} ${err.message}`);
          wrappedError.cause = err;
          throw wrappedError;
        }
        if (!this.isRunCurrent(runContext.runId)) {
          return { result: this.buildAbortedTaskResult(runContext.taskMessages) };
        }

        const leaseBudget = this.evaluateTaskLease(runContext, task);
        if (leaseBudget.warning) {
          this.emitIfCurrent(runContext.runId, { type: "budget-warning", task, message: leaseBudget.warning });
        }
        if (leaseBudget.exceeded) {
          leaseExceeded = true;
          this.emitIfCurrent(runContext.runId, {
            type: "autonomy-blocked",
            reason: leaseBudget.reason ?? "Autonomy lease exhausted.",
            intent: runContext.autonomyIntent
          });
          break;
        }

        if (runContext.channelActionRequirement?.nativeActionRequired) {
          const nativeActionSatisfied = didSatisfyChannelActionRequirement(
            newMessages,
            runContext.channelActionRequirement.action,
          );
          if (!nativeActionSatisfied) {
            runContext.channelActionFeedback = buildChannelActionRetryFeedback(
              runContext.channelActionRequirement,
              runContext.channelContext,
            );

            if (attempt < this.maxTurns - 1) {
              task = await this.transitionTaskPhase(runContext.runId, runContext.session, task, "execute");
              continue;
            }
          }
        } else {
          runContext.channelActionFeedback = undefined;
        }

        const update = updateTaskAfterTurn({ task, turnMessages: newMessages });
        task = update.task;
        if (runContext.taskTodoRecord) {
          task.currentTodoMemoryId = runContext.taskTodoRecord.id;
        }
        this.state.currentTask = task;

        if (update.verification) {
          this.emitIfCurrent(runContext.runId, {
            type: "task-verify-result",
            task,
            passed: update.verification.passed,
            reason: update.verification.reason
          });
        }

        if (update.loopDetected) {
          loopDetected = true;
          await this.blockTask(runContext.runId, runContext.session, task);
          break;
        }

        if (update.nextPhase === "summarize") {
          task = await this.transitionTaskPhase(runContext.runId, runContext.session, task, "summarize");
          break;
        }

        task = await this.transitionTaskPhase(runContext.runId, runContext.session, task, update.nextPhase);
      }

      if (!loopDetected && task.phase !== "summarize") {
        task = await this.transitionTaskPhase(runContext.runId, runContext.session, task, "summarize");
      }

      const result = this.createTaskResult(
        task,
        runContext.taskMessages,
        loopDetected,
        leaseExceeded,
        runContext.channelActionRequirement,
      );
      const diagnosis = diagnoseTaskOutcome(task, result, { loopDetected, leaseExceeded });
      if (diagnosis) {
        this.emitIfCurrent(runContext.runId, {
          type: "self-reflection-generated",
          summary: diagnosis.summary,
          task
        });
      }
      await this.persistTaskMemory(runContext, task, result, { loopDetected, leaseExceeded, diagnosis });
      task = await this.finishTask(runContext.runId, runContext.session, task, result);
      this.emitIfCurrent(runContext.runId, { type: "task-summary", result });
      this.emitIfCurrent(runContext.runId, { type: "run-end", messages: runContext.taskMessages });
      if (runContext.origin === "user") {
        this.scheduleHeartbeat(5_000, "nudge");
      } else {
        this.lastAutonomyRunAt = Date.now();
        this.scheduleHeartbeat();
      }
      return {
        result,
        heartbeatReplyEvaluation: runContext.heartbeatReplyEvaluation,
      };
    } catch (error) {
      if (runContext.controller.signal.aborted || this.isAbortError(error)) {
        this.markTaskAborted();
        this.emitIfCurrent(runContext.runId, { type: "run-aborted", reason: "user" });
        return { result: this.buildAbortedTaskResult([]) };
      }

      const resolvedError = error instanceof Error ? error : new Error(String(error));
      this.emitIfCurrent(runContext.runId, { type: "error", error: resolvedError });
      throw resolvedError;
    } finally {
      this.finishRun(runContext.runId);
    }
  }

  async fork(name?: string): Promise<void> {
    await this.initialize();
    this.assertIdle("fork while agent is running");
    await this.state.session.appendBranch(name);
  }

  async listModels(): Promise<UnifiedModel[]> {
    await this.ensureRegistryLoaded();
    return this.registry.list();
  }

  async listProfiles(): Promise<string[]> {
    await this.ensureRegistryLoaded();
    return this.registry.listProfileNames();
  }

  async listConfiguredProfiles(): Promise<ConfiguredModelProfile[]> {
    await this.ensureRegistryLoaded();
    return this.registry.listProfiles().map((profile: LoadedProfile) => ({
      name: profile.name,
      model: profile.model
    }));
  }

  async refreshRegistry(): Promise<void> {
    await this.registry.load();
    this.registryLoaded = true;
    if (this.initialized) {
      this.state.configSummary = await this.registry.getConfigSummary();
    }
  }

  async setModel(selection: string): Promise<UnifiedModel> {
    await this.ensureRegistryLoaded();
    if (!this.initialized) {
      this.modelSelection = selection;
      await this.initialize();
      return this.state.model;
    }
    this.assertIdle("switch model");
    const model = this.registry.resolve(selection);
    this.modelSelection = selection;
    this.state.model = model;
    this.state.config = {
      ...this.state.config,
      profileName: selection,
      model
    };
    return model;
  }

  async setProfile(profile: string): Promise<ResolvedMonoConfig> {
    await this.ensureRegistryLoaded();
    if (!this.initialized) {
      this.profileSelection = profile;
      this.modelSelection = undefined;
      await this.initialize();
      return this.state.config;
    }
    this.assertIdle("switch profile");
    this.profileSelection = profile;
    this.modelSelection = undefined;
    const resolved = await this.registry.resolveConfig(undefined, profile, this.baseURLOverride);
    this.state.profileName = resolved.profileName;
    this.state.model = resolved.model;
    this.state.config = resolved;
    this.state.memoryStore = new FolderMemoryStore(resolveMemoryStorePath(this.cwd, resolved.memory.storePath));
    this.state.structuredMemoryStore = new FolderStructuredMemoryStore(resolveMemoryStorePath(this.cwd, resolved.memory.v2.storePath));
    this.state.taskTodoStore = new FolderTaskTodoStore(resolveTaskTodoStorePath(this.cwd, resolved.memory.storePath));
    await this.state.structuredMemoryStore.ensureLayout();
    await this.seedStructuredMemoryStore();
    this.state.configSummary = await this.registry.getConfigSummary();
    return resolved;
  }

  async listSessions(): Promise<SessionSummary[]> {
    await this.initialize();
    return SessionManager.listSessions(this.cwd);
  }

  async listThreads(): Promise<ThreadSummary[]> {
    return this.listSessions();
  }

  async listMemories(limit = 10): Promise<MemoryRecord[]> {
    await this.initialize();
    const ids = await this.state.memoryStore.getLatest({ limit });
    return this.state.memoryStore.getByIds(ids);
  }

  async countMemories(): Promise<number> {
    await this.initialize();
    return this.state.memoryStore.count();
  }

  async searchMemories(query: string): Promise<MemorySearchMatch[]> {
    await this.initialize();
    return this.state.memoryStore.searchByKeyword(query, { limit: this.state.config.memory.keywordSearchLimit });
  }

  async getMemoryRecord(id: string): Promise<MemoryRecord | null> {
    await this.initialize();
    return this.state.memoryStore.getById(id);
  }

  async inspectStructuredMemory(entityId?: string): Promise<{
    selfRuntime: SelfRuntimeRecord;
    learningState: LearningState;
    conflicts: OtherConflictRecord[];
    pendingQueue: SalienceQueueRecord[];
    autonomyQueue: AutonomyIntent[];
    feedbackSignals: FeedbackSignal[];
    heartbeatDecisions: HeartbeatDecision[];
    heartbeatReplies: Awaited<ReturnType<FolderStructuredMemoryStore["listHeartbeatReplyRecords"]>>;
    memoryPackage: StructuredMemoryPackage;
  }> {
    await this.initialize();
    const resolvedEntityId = entityId ?? resolvePrimaryEntityId(this.state.config.memory.v2);
    const planner = new StructuredMemoryRetrievalPlanner(this.state.structuredMemoryStore, this.state.config.memory.v2);
    const [selfRuntime, learningState, conflicts, pendingQueue, autonomyQueue, feedbackSignals, heartbeatDecisions, heartbeatReplies, memoryPackage] = await Promise.all([
      this.state.structuredMemoryStore.getSelfRuntime(),
      this.state.structuredMemoryStore.getLearningState(),
      this.state.structuredMemoryStore.listConflicts({ entityId: resolvedEntityId, limit: 10 }),
      this.state.structuredMemoryStore.listSalienceQueue({ entityId: resolvedEntityId, status: "pending", limit: 10 }),
      this.state.structuredMemoryStore.listAutonomyIntents({ limit: 10 }),
      this.state.structuredMemoryStore.listFeedbackSignals({ limit: 10 }),
      this.state.structuredMemoryStore.listHeartbeatDecisions(10),
      this.state.structuredMemoryStore.listHeartbeatReplyRecords({ limit: 10 }),
      planner.buildPackage({
        query: "",
        activeEntityId: resolvedEntityId
      })
    ]);

    return {
      selfRuntime,
      learningState,
      conflicts,
      pendingQueue,
      autonomyQueue,
      feedbackSignals,
      heartbeatDecisions,
      heartbeatReplies,
      memoryPackage
    };
  }

  async countStructuredMemoryState(entityId?: string): Promise<{
    pendingQueue: number;
    autonomyQueue: number;
    feedbackSignals: number;
    heartbeatDecisions: number;
    heartbeatReplies: number;
    conflicts: number;
  }> {
    await this.initialize();
    const resolvedEntityId = entityId ?? resolvePrimaryEntityId(this.state.config.memory.v2);
    const [pendingQueue, autonomyQueue, feedbackSignals, heartbeatDecisions, heartbeatReplies, conflicts] = await Promise.all([
      this.state.structuredMemoryStore.countSalienceQueue({ entityId: resolvedEntityId, status: "pending" }),
      this.state.structuredMemoryStore.countAutonomyIntents(),
      this.state.structuredMemoryStore.countFeedbackSignals(),
      this.state.structuredMemoryStore.countHeartbeatDecisions(),
      this.state.structuredMemoryStore.countHeartbeatReplyRecords(),
      this.state.structuredMemoryStore.countConflicts({ entityId: resolvedEntityId }),
    ]);

    return {
      pendingQueue,
      autonomyQueue,
      feedbackSignals,
      heartbeatDecisions,
      heartbeatReplies,
      conflicts,
    };
  }

  async runHeartbeatOnce(): Promise<{
    decision: AgentState["latestHeartbeatDecision"];
    triggeredIntent?: AutonomyIntent;
  }> {
    await this.initialize();
    const outcome = await this.heartbeatWake.runNow("manual");
    return {
      decision: this.state.latestHeartbeatDecision,
      triggeredIntent: outcome?.intent,
    };
  }

  async recallMemory(query?: string): Promise<MemoryRecallPlan> {
    await this.initialize();
    if (!this.state.config.memory.enabled) {
      return emptyRecallPlan();
    }

    if (query?.trim()) {
      return selectMemoryIdsByKeyword(this.state.memoryStore, {
        query,
        config: this.state.config.memory
      });
    }

    return selectMemoryIdsBySession(this.state.memoryStore, {
      sessionId: this.state.session.sessionId,
      config: this.state.config.memory
    });
  }

  async switchSession(
    sessionId: string,
    branchHeadId?: string,
    options: { preserveCurrentModel?: boolean } = {},
  ): Promise<ConversationMessage[]> {
    await this.initialize();
    this.assertIdle("switch session");
    const sessions = await SessionManager.listSessions(this.cwd);
    const existing = sessions.find((item) => item.sessionId === sessionId);
    const session = new SessionManager({
      cwd: this.cwd,
      sessionId,
      branchHeadId,
      sessionsDir: SessionManager.rootDirFromSessionFile(existing?.filePath ?? this.state.session.filePath)
    });
    await session.initialize(this.state.model);
    const metadata = await session.getMetadata();
    if (metadata && !options.preserveCurrentModel) {
      this.state.model = this.registry.resolve(`${metadata.provider}/${metadata.model}`);
    }
    const messages = await session.loadMessages(branchHeadId);
    this.state.session = session;
    this.state.sessionLoadedAt = Date.now();
    this.state.latestContextReport = undefined;
    this.state.messages = messages;
    this.state.currentTask = await this.loadCurrentTaskForHead(session, branchHeadId);
    this.state.currentTodoRecord = this.state.currentTask?.currentTodoMemoryId
      ? (await this.state.taskTodoStore.get(this.state.currentTask.currentTodoMemoryId)) ?? undefined
      : undefined;
    return messages;
  }

  async resumeThread(
    threadId: string,
    branchHeadId?: string,
    options: { preserveCurrentModel?: boolean } = {},
  ): Promise<ConversationMessage[]> {
    return this.switchSession(threadId, branchHeadId, options);
  }

  async listSessionNodes(): Promise<SessionNodeSummary[]> {
    await this.initialize();
    return this.state.session.listNodes();
  }

  async switchBranch(branchHeadId?: string): Promise<ConversationMessage[]> {
    await this.initialize();
    this.assertIdle("switch branch");
    const messages = await this.state.session.checkout(branchHeadId);
    this.state.latestContextReport = undefined;
    this.state.messages = messages;
    this.state.currentTask = await this.loadCurrentTaskForHead(this.state.session, branchHeadId);
    this.state.currentTodoRecord = this.state.currentTask?.currentTodoMemoryId
      ? (await this.state.taskTodoStore.get(this.state.currentTask.currentTodoMemoryId)) ?? undefined
      : undefined;
    return messages;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.heartbeatWake.stop();
    this.activeRun?.controller.abort(new DOMException("Disposed", "AbortError"));
    this.activeRun = undefined;
    this.listeners.clear();
    this.requestApprovalHandler = undefined;
    this.channelCapabilityProvider = undefined;
  }

  abort(): void {
    this.activeRun?.controller.abort(new DOMException("Aborted", "AbortError"));
  }

  isRunning(): boolean {
    return this.activeRun !== undefined;
  }

  getMessages(): ConversationMessage[] {
    return [...this.state.messages];
  }

  getCurrentModel(): UnifiedModel {
    return this.state.model;
  }

  hasModelSelectionOverride(): boolean {
    return this.modelSelection !== undefined;
  }

  getProfileName(): string {
    return this.state.profileName;
  }

  getCurrentTask(): TaskState | undefined {
    return isForegroundTask(this.state.currentTask) ? this.state.currentTask : undefined;
  }

  getCurrentTodoRecord(): TaskTodoRecord | undefined {
    return this.getCurrentTask() ? this.state.currentTodoRecord : undefined;
  }

  getConfigSummary(): MonoConfigSummary {
    return this.state.configSummary;
  }

  getResolvedConfig(): ResolvedMonoConfig {
    return this.state.config;
  }

  getMemoryStorePath(): string {
    return resolveMemoryStorePath(this.cwd, this.state.config.memory.storePath);
  }

  getStructuredMemoryStorePath(): string {
    return resolveMemoryStorePath(this.cwd, this.state.config.memory.v2.storePath);
  }

  getSessionId(): string {
    return this.state.session.sessionId;
  }

  getThreadId(): string {
    return this.getSessionId();
  }

  getBranchHeadId(): string | undefined {
    return this.state.session.getHeadId();
  }

  getLatestContextReport(): ContextAssemblyReport | undefined {
    return this.state.latestContextReport;
  }

  async inspectContext(prompt?: string): Promise<{ systemPrompt: string; report: ContextAssemblyReport }> {
    await this.initialize();
    const goal = prompt?.trim() || this.state.currentTask?.goal || "";
    const memoryPlan = this.state.config.memory.enabled && this.state.config.memory.autoInject
      ? await this.recallMemory(goal || undefined)
      : emptyRecallPlan();
    const executionMemoryContext =
      this.state.config.memory.enabled
      && this.state.config.memory.autoInject
      && this.state.config.context.memory.injectRetrievedMemory
      && memoryPlan.selectedIds.length > 0
        ? await this.renderMemoryContext(memoryPlan)
        : "";
    const structuredMemoryContext = await this.buildStructuredMemoryContext(goal);
    const memoryContext = [executionMemoryContext, structuredMemoryContext].filter(Boolean).join("\n\n");
    const skillsContext = await this.loadSkillsContextForTaskTurn(goal);
    const taskContext = this.buildInspectableTaskContext(goal);
    const assembled = await assemblePromptContext({
      cwd: this.cwd,
      sessionId: this.state.session.sessionId,
      sessionStartedAt: this.state.sessionLoadedAt,
      profileName: this.state.profileName,
      model: this.state.model,
      thinkingLevel: this.state.thinkingLevel,
      verificationMode: this.state.currentTask?.verification.mode ?? this.verificationMode ?? "light",
      sandboxMode: this.resolveSandboxMode(),
      approvalPolicy: this.resolveApprovalPolicy(),
      autoApprove: this.isApprovalAutoApproved(this.resolveApprovalPolicy()),
      config: this.state.config,
      taskContext,
      memoryContext,
      skillsContext,
      memoryPlan
    });
    this.state.latestContextReport = assembled.report;
    return {
      systemPrompt: assembled.systemPrompt,
      report: assembled.report
    };
  }

  private emit(event: RuntimeEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private async requestApproval(request: ApprovalRequest, approvalPolicy: ApprovalPolicy): Promise<boolean> {
    if (this.activeRun?.controller.signal.aborted) {
      return false;
    }
    if (this.isApprovalAutoApproved(approvalPolicy)) {
      return true;
    }
    if (!this.requestApprovalHandler) {
      return false;
    }
    return this.requestApprovalHandler(request);
  }

  private async requestExplicitApproval(request: ApprovalRequest): Promise<boolean> {
    if (this.activeRun?.controller.signal.aborted) {
      return false;
    }
    if (!this.requestApprovalHandler) {
      return false;
    }
    return this.requestApprovalHandler(request);
  }

  private resolveSandboxMode(override?: SandboxMode): SandboxMode {
    const resolved = override ?? this.sandboxModeOverride ?? this.state.config.settings.sandboxMode;
    const normalized = normalizeSandboxMode(resolved);
    if (!normalized) {
      throw new Error("Sandbox mode could not be resolved.");
    }
    return normalized;
  }

  private resolveApprovalPolicy(override?: ApprovalPolicy): ApprovalPolicy {
    if (this.autoApprove) {
      return "auto-approve";
    }
    const resolved = override ?? this.approvalPolicyOverride ?? this.state.config.settings.approvalPolicy;
    const normalized = normalizeApprovalPolicy(resolved);
    if (!normalized) {
      throw new Error("Approval policy could not be resolved.");
    }
    return normalized;
  }

  private isApprovalAutoApproved(policy: ApprovalPolicy): boolean {
    return policy === "auto-approve";
  }

  private assertIdle(action: string): void {
    if (this.isRunning()) {
      throw new Error(`Cannot ${action} while agent is running`);
    }
  }

  private startRun(): { id: number; controller: AbortController } {
    this.assertIdle("start a new prompt");
    const run = {
      id: this.nextRunId,
      controller: new AbortController()
    };
    this.nextRunId += 1;
    this.activeRun = run;
    return run;
  }

  private async ensureRegistryLoaded(): Promise<void> {
    if (this.registryLoaded) {
      return;
    }

    await this.registry.load();
    this.registryLoaded = true;
  }

  private isRunCurrent(runId: number): boolean {
    return this.activeRun?.id === runId;
  }

  private finishRun(runId: number): void {
    if (this.activeRun?.id === runId) {
      this.activeRun = undefined;
    }
  }

  private emitIfCurrent(runId: number, event: RuntimeEvent): void {
    if (this.isRunCurrent(runId)) {
      this.emit(event);
    }
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
  }

  private markTaskAborted(): void {
    if (!this.state.currentTask) {
      return;
    }
    this.state.currentTask = advanceTaskPhase(this.state.currentTask, "aborted");
  }

  private buildAbortedTaskResult(messages: ConversationMessage[]): TaskResult {
    return {
      status: "aborted",
      summary: "Task was cancelled before completion.",
      turns: this.state.currentTask?.attempts ?? 0,
      verification: this.state.currentTask?.verification,
      messages
    };
  }

  private async seedStructuredMemoryStore(): Promise<void> {
    if (!this.state.config.memory.v2.enabled) {
      return;
    }

    const [identityRecord, projectProfile, selfRuntime] = await Promise.all([
      this.state.structuredMemoryStore.getSelfIdentity(),
      this.state.structuredMemoryStore.getProjectProfile(),
      this.state.structuredMemoryStore.getSelfRuntime(),
    ]);

    const desiredAutonomyPolicy = {
      ...selfRuntime.autonomyPolicy,
      enabled: this.state.config.settings.autonomy.enabled,
      heartbeatIntervalMs: this.state.config.settings.autonomy.heartbeatIntervalMs,
      maxAutonomousTasksPerHour: this.state.config.settings.autonomy.maxAutonomousTasksPerHour,
      allowBroadExecution: this.state.config.settings.autonomy.allowBroadExecution,
      isolatedSession: this.state.config.settings.autonomy.isolatedSession,
    };

    if (
      selfRuntime.autonomyPolicy.enabled !== desiredAutonomyPolicy.enabled
      || selfRuntime.autonomyPolicy.heartbeatIntervalMs !== desiredAutonomyPolicy.heartbeatIntervalMs
      || selfRuntime.autonomyPolicy.maxAutonomousTasksPerHour !== desiredAutonomyPolicy.maxAutonomousTasksPerHour
      || selfRuntime.autonomyPolicy.allowBroadExecution !== desiredAutonomyPolicy.allowBroadExecution
      || selfRuntime.autonomyPolicy.isolatedSession !== desiredAutonomyPolicy.isolatedSession
    ) {
      await this.state.structuredMemoryStore.upsertSelfRuntime({
        autonomyPolicy: desiredAutonomyPolicy,
      });
    }

    if (!identityRecord.summary && identityRecord.nonNegotiablePrinciples.length === 0) {
      const identityText = await this.readWorkspaceTextFile(".mono/IDENTITY.md");
      if (identityText) {
        const lines = this.toBulletLikeLines(identityText);
        await this.state.structuredMemoryStore.upsertSelfIdentity({
          summary: lines.slice(0, 3).join(" "),
          nonNegotiablePrinciples: lines.slice(0, 4),
          styleContract: lines.slice(0, 4)
        });
      }
    }

    if (!projectProfile.workspaceSummary && projectProfile.durableFacts.length === 0) {
      const [contextText, memoryText, readmeText] = await Promise.all([
        this.readWorkspaceTextFile(".mono/CONTEXT.md"),
        this.readWorkspaceTextFile(".mono/MEMORY.md"),
        this.readWorkspaceTextFile("README.md")
      ]);
      const contextLines = this.toBulletLikeLines(contextText ?? "");
      const memoryLines = this.toBulletLikeLines(memoryText ?? "");
      const readmeLines = this.toBulletLikeLines(readmeText ?? "");
      await this.state.structuredMemoryStore.upsertProjectProfile({
        workspaceSummary: contextLines[0] ?? readmeLines[0] ?? "",
        durableFacts: [...new Set([...memoryLines, ...readmeLines.slice(0, 3)])].slice(0, 6),
        collaborationNorms: contextLines.slice(0, 5)
      });
    }
  }

  private async renderMemoryContext(plan: MemoryRecallPlan): Promise<string> {
    const records = await this.state.memoryStore.getByIds(plan.selectedIds);
    return renderMemoryContext(records, new Set(plan.compactedIds));
  }

  private async buildStructuredMemoryContext(
    query: string,
    externalItems: RetrievedContextItem[] = []
  ): Promise<string> {
    if (!this.state.config.memory.v2.enabled || !this.state.config.memory.v2.injectIntoContext) {
      return "";
    }

    let combinedExternalItems = externalItems;
    if (combinedExternalItems.length === 0 && this.state.config.memory.openViking.enabled && this.state.config.memory.openViking.url && query.trim()) {
      try {
        const { OpenVikingRetrievalProvider } = await this.loadOpenVikingAdapterModule();
        const provider = new OpenVikingRetrievalProvider({
          config: this.state.config.memory.openViking
        });
        const retrieved = await provider.recallForQuery({
          query,
          sessionId: this.state.session.sessionId,
          messages: this.state.messages
        });
        combinedExternalItems = retrieved.items;
      } catch {
        combinedExternalItems = externalItems;
      }
    }

    const planner = new StructuredMemoryRetrievalPlanner(this.state.structuredMemoryStore, this.state.config.memory.v2);
    const memoryPackage = await planner.buildPackage({
      query,
      activeEntityId: resolvePrimaryEntityId(this.state.config.memory.v2),
      externalItems: combinedExternalItems
    });
    return renderStructuredMemoryPackage(memoryPackage);
  }

  private async readWorkspaceTextFile(relativePath: string): Promise<string | undefined> {
    try {
      return await readFile(join(this.cwd, relativePath), "utf8");
    } catch {
      return undefined;
    }
  }

  private toBulletLikeLines(text: string): string[] {
    return text
      .split("\n")
      .map((line) => line.trim().replace(/^[-*]\s+/u, ""))
      .filter((line) => line && !line.startsWith("#"))
      .slice(0, 12);
  }

   private createLocalMemoryRetrievalProvider(): LocalMemoryRetrievalProvider {
     return new LocalMemoryRetrievalProvider(this.state.memoryStore, this.state.config.memory);
   }

   private async loadOpenVikingAdapterModule(): ReturnType<typeof loadOpenVikingAdapter> {
     return loadOpenVikingAdapter();
   }

   private async loadSeekDbAdapterModule(): ReturnType<typeof loadSeekDbAdapter> {
     return loadSeekDbAdapter();
   }

   private async createConfiguredMemoryRetrievalProvider(): Promise<MemoryRetrievalProvider> {
     const backend = this.state.config.memory.retrievalBackend;
     if (backend === "local") {
       return this.createLocalMemoryRetrievalProvider();
     }

     if (backend === "openviking") {
       const config = this.state.config.memory.openViking;
       assertOpenVikingConfig(config);
       const { OpenVikingRetrievalProvider } = await this.loadOpenVikingAdapterModule();
       return new OpenVikingRetrievalProvider({
         config
       });
     }

     const config = this.state.config.memory.seekDb;
     assertSeekDbConfig(config);
     const { SeekDbExecutionMemoryBackend, SeekDbRetrievalProvider, SeekDbSessionMirror } = await this.loadSeekDbAdapterModule();
     const executionMemory = new SeekDbExecutionMemoryBackend({ config });
     const sessionMirror = new SeekDbSessionMirror({ config });
     return new SeekDbRetrievalProvider({
       config,
       backend: executionMemory,
       sessionMirror
     });
   }

   private async recallInjectedMemoryContext(query?: string): Promise<RetrievedContext> {
     const localProvider = this.createLocalMemoryRetrievalProvider();
     const recallLocally = (): Promise<RetrievedContext> =>
       localProvider.recallForSession({
         sessionId: this.state.session.sessionId,
         messages: this.state.messages,
         query
       });

     if (this.state.config.memory.retrievalBackend === "local") {
       return recallLocally();
     }

     try {
       const provider = await this.createConfiguredMemoryRetrievalProvider();
       return await provider.recallForSession({
         sessionId: this.state.session.sessionId,
         messages: this.state.messages,
         query
       });
     } catch (error) {
       if (!this.state.config.memory.fallbackToLocalOnFailure) {
         throw error;
       }
       return recallLocally();
     }
   }

  private async syncConfiguredMemoryBackends(record: MemoryRecord, session: SessionManager): Promise<void> {
    const syncOperations: Array<Promise<unknown>> = [];
     const openViking = this.state.config.memory.openViking;
     if (openViking.enabled && openViking.shadowExport && openViking.url) {
       syncOperations.push(
         this.loadOpenVikingAdapterModule().then(async ({ OpenVikingShadowExporter }) => {
           const exporter = new OpenVikingShadowExporter({
             config: openViking
           });
           await exporter.exportRecord(record);
         })
       );
     }

     const seekDb = this.state.config.memory.seekDb;
     if (seekDb.enabled) {
       syncOperations.push(
         this.loadSeekDbAdapterModule().then(async ({ SeekDbExecutionMemoryBackend, SeekDbSessionMirror }) => {
           const sessionMirror = new SeekDbSessionMirror({ config: seekDb });
           const entries = await session.readEntries();
           await sessionMirror.mirrorSession({
             sessionId: session.sessionId,
             cwd: this.cwd,
             headId: session.getHeadId(),
             entries
           });

           if (seekDb.mirrorSessionsOnly) {
             return;
           }

           assertSeekDbConfig(seekDb);
           const executionMemory = new SeekDbExecutionMemoryBackend({ config: seekDb });
           await executionMemory.append(record);
         })
       );
     }

     if (syncOperations.length === 0) {
       return;
     }

    await Promise.allSettled(syncOperations);
  }

  private async syncStructuredMemoryBackends(records: Array<{
    id: string;
    scope: "self" | "other" | "project" | "episodic";
    title: string;
    summary: string;
    detailLines?: string[];
  }>): Promise<void> {
    if (records.length === 0) {
      return;
    }
    const openViking = this.state.config.memory.openViking;
    if (!openViking.enabled || !openViking.url || this.state.config.memory.v2.openVikingSync !== "async") {
      return;
    }

    const { OpenVikingStructuredShadowExporter } = await this.loadOpenVikingAdapterModule();
    const exporter = new OpenVikingStructuredShadowExporter({
      config: openViking
    });
    await Promise.allSettled(records.map((record) => exporter.exportRecord(record)));
  }

  private async compactAndPersistTurn(options: {
    userMessage: UserMessage;
    messages: ConversationMessage[];
    recallPlan?: MemoryRecallPlan;
  }): Promise<MemoryRecord | null> {
    const assistantOutput = options.messages
      .filter((message): message is Extract<ConversationMessage, { role: "assistant" }> => message.role === "assistant")
      .map((message) =>
        message.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("")
      )
      .join("\n")
      .trim();

    const hasUsefulOutput = assistantOutput.length > 0 || options.messages.some((message) => message.role === "tool");
    if (!hasUsefulOutput) {
      return null;
    }

    const trace = buildDetailedTrace(options.userMessage, options.messages);
    const compacted = await this.memoryCompactor.compact({
      userRequest: userContentToPlainText(options.userMessage.content),
      assistantOutput,
      trace,
      referencedMemoryIds: options.recallPlan?.selectedIds ?? []
    });

    const metadata = buildMemoryRecordMetadata(trace, compacted.compacted, compacted.rawInput, compacted.rawOutput);
    const record: MemoryRecord = {
      id: createMemoryId(),
      createdAt: Date.now(),
      projectKey: projectKeyFromCwd(this.cwd),
      sessionId: this.state.session.sessionId,
      branchHeadId: this.state.session.getHeadId(),
      parents: options.recallPlan?.rootIds ?? [],
      children: [],
      referencedMemoryIds: options.recallPlan?.selectedIds ?? [],
      input: compacted.rawInput,
      compacted: compacted.compacted,
      output: compacted.rawOutput,
      detailed: trace,
      tags: metadata.tags,
      files: metadata.files,
      tools: metadata.tools
    };
    await this.state.memoryStore.append(record);
    return record;
  }

  private ensureHeartbeatLoop(): void {
    this.heartbeatWake.setHandler((trigger) => this.runHeartbeat(trigger));
    this.scheduleHeartbeat();
  }

  private scheduleHeartbeat(delayMs = 30_000, trigger: HeartbeatWakeTrigger = "timer"): void {
    if (!this.canScheduleHeartbeat()) {
      return;
    }
    this.heartbeatWake.requestWake({ trigger, delayMs });
  }

  private async runHeartbeat(trigger: HeartbeatWakeTrigger): Promise<{ intent?: AutonomyIntent } | undefined> {
    if (!this.initialized || this.disposed) {
      return undefined;
    }

    const now = Date.now();
    this.emit({ type: "heartbeat-start", timestamp: now });

    if (!this.state.config.memory.v2.enabled) {
      return this.skipHeartbeat(now, "Structured memory is disabled.");
    }
    if (this.isRunning()) {
      return this.skipHeartbeat(now, "A task is already running.", 1_000);
    }

    const heartbeatState = await this.loadHeartbeatRuntimeState();
    const { selfRuntime } = heartbeatState;

    if (!selfRuntime.autonomyPolicy.enabled) {
      return this.skipHeartbeat(now, "Autonomy policy is disabled.", selfRuntime.autonomyPolicy.heartbeatIntervalMs);
    }

    const recentAutonomyCount = this.countRecentAutonomyRuns(heartbeatState.recentIntents, now);
    if (recentAutonomyCount >= selfRuntime.autonomyPolicy.maxAutonomousTasksPerHour) {
      return this.skipHeartbeat(now, "Autonomy hourly cap reached.", selfRuntime.autonomyPolicy.heartbeatIntervalMs, true);
    }

    if (trigger === "timer" && now - this.lastAutonomyRunAt < 15_000) {
      return this.skipHeartbeat(now, "Recent autonomy run still in cooldown.", selfRuntime.autonomyPolicy.heartbeatIntervalMs, true);
    }

    const selection = buildHeartbeatSelection({
      now,
      selfRuntime: heartbeatState.selfRuntime,
      learningState: heartbeatState.learningState,
      todos: heartbeatState.todos,
      recentFeedback: heartbeatState.recentFeedback,
      recentSessionTexts: heartbeatState.recentSessionTexts,
      recentIntents: heartbeatState.recentIntents,
      currentTaskId: this.state.currentTask?.taskId,
    });
    await this.persistHeartbeatSelection(selection.decision, now);
    if (!selection.selectedIntent) {
      this.scheduleHeartbeat(selfRuntime.autonomyPolicy.heartbeatIntervalMs);
      return { intent: undefined };
    }

    return this.processSelectedHeartbeatIntent(selection.selectedIntent, now, selfRuntime.autonomyPolicy.heartbeatIntervalMs);
  }

  private async loadHeartbeatRuntimeState(): Promise<HeartbeatRuntimeState> {
    const [selfRuntime, learningState, todos, recentFeedback, recentIntents, sessionMessages] = await Promise.all([
      this.state.structuredMemoryStore.getSelfRuntime(),
      this.state.structuredMemoryStore.getLearningState(),
      this.state.taskTodoStore.listBySession(this.state.session.sessionId),
      this.state.structuredMemoryStore.listFeedbackSignals({ limit: 12 }),
      this.state.structuredMemoryStore.listAutonomyIntents({ limit: 24 }),
      this.state.session.loadMessages(),
    ]);

    return {
      selfRuntime,
      learningState,
      todos,
      recentFeedback,
      recentIntents,
      recentSessionTexts: this.listRecentVisibleSessionTexts(sessionMessages),
    };
  }

  private countRecentAutonomyRuns(intents: AutonomyIntent[], now: number): number {
    return intents.filter((item) =>
      item.createdAt >= now - 60 * 60_000
      && item.status !== "pending"
    ).length;
  }

  private async skipHeartbeat(
    timestamp: number,
    reason: string,
    nextDelayMs = 30_000,
    updateRuntimeState = false
  ): Promise<undefined> {
    await this.recordHeartbeatDecision({
      timestamp,
      decision: "noop",
      reasons: [reason],
      candidates: [],
    });
    this.emit({ type: "heartbeat-skip", reason, timestamp });
    if (updateRuntimeState) {
      await this.state.structuredMemoryStore.upsertSelfRuntime({ lastHeartbeatAt: timestamp });
    }
    this.scheduleHeartbeat(nextDelayMs);
    return undefined;
  }

  private async persistHeartbeatSelection(decision: HeartbeatDecision, timestamp: number): Promise<void> {
    await this.recordHeartbeatDecision(decision);
    this.emit({ type: "heartbeat-decision", decision });
    await this.state.structuredMemoryStore.upsertSelfRuntime({ lastHeartbeatAt: timestamp });
  }

  private async processSelectedHeartbeatIntent(
    intent: AutonomyIntent,
    startedAt: number,
    nextDelayMs: number
  ): Promise<{ intent: AutonomyIntent }> {
    const storedIntent = await this.persistHeartbeatIntent(intent);

    if (storedIntent.recommendedAction === "request_user_confirmation") {
      await this.blockHeartbeatIntent(storedIntent, "Autonomy policy requires confirmation for this intent.", nextDelayMs);
      return { intent: storedIntent };
    }
    if (storedIntent.recommendedAction === "defer") {
      await this.deferHeartbeatIntent(storedIntent, nextDelayMs);
      return { intent: storedIntent };
    }
    if (storedIntent.riskLevel === "high") {
      await this.blockHeartbeatIntent(storedIntent, "High-risk autonomy intent requires confirmation.", nextDelayMs);
      return { intent: storedIntent };
    }

    await this.state.structuredMemoryStore.updateAutonomyIntent(storedIntent.id, { status: "accepted" });
    try {
      if (storedIntent.kind === "curiosity_probe") {
        await this.applyCuriosityCooldown(startedAt);
      }
      const isolatedSession = (await this.state.structuredMemoryStore.getSelfRuntime()).autonomyPolicy.isolatedSession;
      const execution = await this.runAutonomousTask(storedIntent, startedAt, isolatedSession);
      await this.handleHeartbeatExecutionOutcome(storedIntent, execution);
      await this.state.structuredMemoryStore.updateAutonomyIntent(storedIntent.id, {
        status: this.resolveCompletedIntentStatus(execution.result.status),
      });
    } catch (error) {
      await this.state.structuredMemoryStore.updateAutonomyIntent(storedIntent.id, { status: "blocked" });
      throw error;
    } finally {
      this.scheduleHeartbeat(nextDelayMs);
    }

    return { intent: storedIntent };
  }

  private async runAutonomousTask(
    intent: AutonomyIntent,
    startedAt: number,
    isolatedSession: boolean
  ): Promise<HeartbeatTaskExecution> {
    const isCuriosityIntent = intent.kind === "curiosity_probe";
    const options: RunTaskOptions = {
      interactionMode: isCuriosityIntent ? "curiosity" : "default",
      origin: intent.recommendedAction === "resume_task" ? "resume" : "heartbeat",
      autonomyIntent: intent,
      lease: isCuriosityIntent ? createCuriosityLease(startedAt) : createAutonomyLease(startedAt),
      extraTaskContext: buildAutonomyExtraContext(intent),
    };
    if (!isolatedSession) {
      const execution = await this.runTaskDetailed(intent.goal, options);
      return {
        result: execution.result,
        sessionId: this.state.session.sessionId,
        filePath: this.state.session.filePath,
        isolatedSession: false,
        heartbeatReplyEvaluation: execution.heartbeatReplyEvaluation,
      };
    }

    return this.withIsolatedHeartbeatSession(async (session) => ({
      ...(await this.runTaskDetailed(intent.goal, options)),
      sessionId: session.sessionId,
      filePath: session.filePath,
      isolatedSession: true,
    }));
  }

  private async persistHeartbeatIntent(intent: AutonomyIntent): Promise<AutonomyIntent> {
    const storedIntent = await this.state.structuredMemoryStore.appendAutonomyIntent(intent);
    if (storedIntent.recommendedAction === "resume_task") {
      this.emit({ type: "autonomy-task-resumed", intent: storedIntent });
    } else {
      this.emit({ type: "autonomy-task-enqueued", intent: storedIntent });
    }
    return storedIntent;
  }

  private async blockHeartbeatIntent(intent: AutonomyIntent, reason: string, nextDelayMs: number): Promise<void> {
    await this.state.structuredMemoryStore.updateAutonomyIntent(intent.id, { status: "blocked" });
    this.emit({ type: "autonomy-blocked", reason, intent });
    this.scheduleHeartbeat(nextDelayMs);
  }

  private async deferHeartbeatIntent(intent: AutonomyIntent, nextDelayMs: number): Promise<void> {
    await this.state.structuredMemoryStore.updateAutonomyIntent(intent.id, { status: "deferred" });
    this.scheduleHeartbeat(nextDelayMs);
  }

  private resolveCompletedIntentStatus(status: TaskResult["status"]): AutonomyIntent["status"] {
    if (status === "done") {
      return "completed";
    }
    if (status === "blocked") {
      return "blocked";
    }
    return "deferred";
  }

  private async withIsolatedHeartbeatSession<T>(operation: (session: SessionManager) => Promise<T>): Promise<T> {
    const snapshot = this.captureTransientTaskState();
    const isolatedSession = await this.createIsolatedHeartbeatSession();
    this.state.session = isolatedSession;
    this.state.messages = [];
    this.state.sessionLoadedAt = Date.now();
    this.state.latestContextReport = undefined;
    this.state.currentTask = undefined;
    this.state.currentTodoRecord = undefined;

    try {
      return await operation(isolatedSession);
    } finally {
      this.restoreTransientTaskState(snapshot);
    }
  }

  private captureTransientTaskState(): TransientTaskStateSnapshot {
    return {
      session: this.state.session,
      messages: [...this.state.messages],
      sessionLoadedAt: this.state.sessionLoadedAt,
      latestContextReport: this.state.latestContextReport,
      currentTask: this.state.currentTask,
      currentTodoRecord: this.state.currentTodoRecord,
    };
  }

  private restoreTransientTaskState(snapshot: TransientTaskStateSnapshot): void {
    this.state.session = snapshot.session;
    this.state.messages = snapshot.messages;
    this.state.sessionLoadedAt = snapshot.sessionLoadedAt;
    this.state.latestContextReport = snapshot.latestContextReport;
    this.state.currentTask = snapshot.currentTask;
    this.state.currentTodoRecord = snapshot.currentTodoRecord;
  }

  private async createIsolatedHeartbeatSession(): Promise<SessionManager> {
    const session = new SessionManager({
      cwd: this.cwd,
      sessionId: `heartbeat-${createId()}`,
      sessionsDir: SessionManager.rootDirFromSessionFile(this.state.session.filePath),
    });
    await session.initialize(this.state.model);
    return session;
  }

  private async handleHeartbeatExecutionOutcome(intent: AutonomyIntent, execution: HeartbeatTaskExecution): Promise<void> {
    const evaluation = execution.heartbeatReplyEvaluation;
    if (!evaluation) {
      return;
    }
    if (intent.kind === "curiosity_probe" && evaluation.status === "sent") {
      await this.persistCuriosityReply(evaluation.visibleText);
    }
    if (execution.isolatedSession && evaluation.status !== "sent") {
      await this.pruneIsolatedHeartbeatSession(execution.filePath);
    }
  }

  private async loadPreviousHeartbeatReplyText(comparisonKey: string): Promise<string | undefined> {
    const previousReplies = await this.state.structuredMemoryStore.listHeartbeatReplyRecords({
      comparisonKey,
      limit: 5,
    });
    return previousReplies.map((record) => record.normalizedText).find(Boolean);
  }

  private async pruneIsolatedHeartbeatSession(filePath: string): Promise<void> {
    await rm(filePath, { force: true }).catch(() => undefined);
  }

  private async recordHeartbeatDecision(decision: HeartbeatDecision): Promise<void> {
    this.state.latestHeartbeatDecision = {
      timestamp: decision.timestamp,
      decision: decision.decision,
    };
    if (!this.state.config.memory.v2.enabled) {
      return;
    }
    await this.state.structuredMemoryStore.appendHeartbeatDecision(decision);
  }

  private async applyCuriosityCooldown(timestamp: number): Promise<void> {
    const currentRuntime = await this.state.structuredMemoryStore.getSelfRuntime();
    await this.state.structuredMemoryStore.upsertSelfRuntime({
      cooldowns: this.mergeRuntimeCooldowns(currentRuntime.cooldowns, [{
        key: CURIOSITY_COOLDOWN_KEY,
        until: timestamp + CURIOSITY_COOLDOWN_MS,
        reason: "A recent curiosity probe already explored the current runtime context.",
      }]),
    });
  }

  private async persistCuriosityReply(text: string): Promise<void> {
    const fields = extractCuriosityReplyFields(text);
    if (!fields.question || !fields.hypothesis || !fields.evidence) {
      return;
    }

    const currentRuntime = await this.state.structuredMemoryStore.getSelfRuntime();
    await this.state.structuredMemoryStore.upsertSelfRuntime({
      openQuestions: this.appendUniqueTail(currentRuntime.openQuestions, fields.question, 6),
      currentHypotheses: this.appendUniqueTail(currentRuntime.currentHypotheses, fields.hypothesis, 6),
    });
  }

  private handleHeartbeatFailure(error: unknown): void {
    const resolvedError = error instanceof Error ? error : new Error(String(error));
    this.emit({ type: "error", error: resolvedError });
  }

  private canScheduleHeartbeat(): boolean {
    return this.initialized && this.heartbeatEnabled && !this.disposed;
  }

  private listRecentVisibleSessionTexts(messages: ConversationMessage[]): string[] {
    return messages
      .flatMap((message) => message.role === "user"
        ? (() => {
            const text = userContentToPlainText(message.content).trim();
            return text ? [text] : [];
          })()
        : [])
      .slice(-8);
  }

  private appendUniqueTail(items: string[], nextItem: string, limit: number): string[] {
    const normalizedNext = nextItem.trim();
    if (!normalizedNext) {
      return items;
    }
    return [...new Set([...items, normalizedNext])].slice(-limit);
  }

  private mergeRuntimeCooldowns(
    current: Array<{ key: string; until: number; reason: string }>,
    additions: Array<{ key: string; until: number; reason: string }>,
  ): Array<{ key: string; until: number; reason: string }> {
    const next = new Map(current.map((item) => [item.key, item]));
    for (const addition of additions) {
      next.set(addition.key, addition);
    }
    return [...next.values()]
      .sort((left, right) => right.until - left.until)
      .slice(0, 8);
  }

  private evaluateTaskLease(context: TaskRunContext, task: TaskState): {
    warning?: string;
    exceeded: boolean;
    reason?: string;
  } {
    if (!task.lease) {
      return { exceeded: false };
    }

    const elapsedMs = Date.now() - task.lease.startedAt;
    const toolCalls = context.taskMessages.filter((message) => message.role === "tool").length;
    if (elapsedMs > task.lease.maxWallTimeMs) {
      return {
        exceeded: true,
        reason: "Autonomy lease exceeded wall-time budget.",
      };
    }
    if (toolCalls > task.lease.maxToolCalls) {
      return {
        exceeded: true,
        reason: "Autonomy lease exceeded tool budget.",
      };
    }
    if (elapsedMs >= task.lease.maxWallTimeMs * 0.8) {
      return {
        exceeded: false,
        warning: "Autonomy lease is nearing its wall-time budget.",
      };
    }
    if (toolCalls >= Math.max(1, Math.floor(task.lease.maxToolCalls * 0.8))) {
      return {
        exceeded: false,
        warning: "Autonomy lease is nearing its tool-call budget.",
      };
    }

    return { exceeded: false };
  }

  private async integrateTaskFeedback(
    entityId: string,
    task: TaskState,
    result: TaskResult,
    options: {
      loopDetected: boolean;
      leaseExceeded: boolean;
      diagnosis: ReturnType<typeof diagnoseTaskOutcome>;
    },
    context: TaskRunContext
  ): Promise<void> {
    const now = Date.now();
    const explicitUserFeedback = context.origin === "user"
      ? extractUserFeedbackSignals(userContentToPlainText(context.userMessage.content), now)
      : [];
    const signals = [
      ...explicitUserFeedback,
      ...buildFeedbackSignals(task, result, {
      diagnosis: options.diagnosis,
      loopDetected: options.loopDetected,
      leaseExceeded: options.leaseExceeded,
      now,
      }),
    ];
    const [currentRuntime, currentLearningState] = await Promise.all([
      this.state.structuredMemoryStore.getSelfRuntime(),
      this.state.structuredMemoryStore.getLearningState(),
    ]);

    const nextRuntime = applyFeedbackToSelfRuntime(currentRuntime, signals, options.diagnosis, now);
    const nextLearningState = applyFeedbackToLearningState(
      currentLearningState,
      signals,
      task,
      options.diagnosis,
      now,
      {
        autonomyIntent: context.autonomyIntent,
        heartbeatReplyEvaluation: context.heartbeatReplyEvaluation
          ? {
            status: context.heartbeatReplyEvaluation.status,
            visibleText: context.heartbeatReplyEvaluation.visibleText,
            reason: context.heartbeatReplyEvaluation.reason,
          }
          : undefined,
        taskStatus: result.status,
      },
    );

    await Promise.all([
      this.state.structuredMemoryStore.upsertSelfRuntime(nextRuntime),
      this.state.structuredMemoryStore.upsertLearningState(nextLearningState),
      ...signals.map((signal) => this.state.structuredMemoryStore.appendFeedbackSignal(signal)),
      this.state.structuredMemoryStore.appendEpisodicEvent({
        createdAt: now,
        origin: "feedback",
        entityId,
        sessionId: context.session.sessionId,
        branchHeadId: context.session.getHeadId(),
        queryText: task.goal,
        summary: `Integrated ${signals.length} feedback signal(s) for ${task.goal}`,
        messages: signals.map((signal) => signal.summary).slice(0, 4),
        salience: signals.some((item) => item.valence === "negative") ? 0.85 : 0.45,
        extractedPreferenceKeys: [],
      }),
    ]);

    if (signals.length > 0) {
      this.emitIfCurrent(context.runId, { type: "feedback-integrated", signals });
    }
  }

  private createTaskRunContext(input: string | TaskInput, options: RunTaskOptions): TaskRunContext {
    const run = this.startRun();
    const normalizedInput = typeof input === "string" ? { text: input } : input;
    const userMessage = taskInputToUserMessage(normalizedInput);
    return {
      runId: run.id,
      controller: run.controller,
      session: this.state.session,
      model: this.state.model,
      interactionMode: options.interactionMode ?? "default",
      channel: options.channel,
      input: normalizedInput,
      extraTaskContext: options.extraTaskContext,
      channelContext: null,
      channelActionRequirement: undefined,
      channelActionFeedback: undefined,
      userMessage: {
        ...userMessage,
        origin: options.origin ?? "user",
        parentIntentId: options.autonomyIntent?.id,
      },
      taskMessages: [],
      recallAccumulator: createRecallAccumulator(),
      taskTodoRecord: null,
      taskTodosDirty: false,
      allowedToolNames: undefined,
      sandboxMode: this.resolveSandboxMode(normalizeSandboxMode(options.sandboxMode)),
      approvalPolicy: this.resolveApprovalPolicy(normalizeApprovalPolicy(options.approvalPolicy)),
      origin: options.origin ?? "user",
      autonomyIntent: options.autonomyIntent,
      lease: options.lease,
    };
  }

  private async beginTaskRun(context: TaskRunContext): Promise<void> {
    this.state.messages.push(context.userMessage);
    if (context.origin === "user") {
      await context.session.appendMessage(context.userMessage);
    } else {
      await context.session.appendAutonomyTrigger(context.userMessage);
    }
    this.emitIfCurrent(context.runId, { type: "run-start", input: context.userMessage });
    this.emitIfCurrent(context.runId, { type: "message", message: context.userMessage });
  }

  private applyRunMode(task: TaskState, context: TaskRunContext): TaskState {
    if (context.interactionMode === "channel_chat" || context.interactionMode === "curiosity") {
      return applyVerificationMode(task, "none");
    }
    return this.verificationMode ? applyVerificationMode(task, this.verificationMode) : task;
  }

  private async startTaskLifecycle(runId: number, session: SessionManager, task: TaskState): Promise<void> {
    await this.publishTaskStart(runId, session, task);
    await this.transitionTaskPhase(runId, session, task, "execute");
  }

  private async publishTaskStart(runId: number, session: SessionManager, task: TaskState): Promise<void> {
    const plannedTask = advanceTaskPhase(task, "plan");
    this.state.currentTask = plannedTask;
    await this.appendTaskPointer(session, plannedTask);
    this.emitIfCurrent(runId, { type: "task-start", task: plannedTask });
  }

  private async transitionTaskPhase(
    runId: number,
    session: SessionManager,
    task: TaskState,
    phase: TaskState["phase"]
  ): Promise<TaskState> {
    const nextTask = advanceTaskPhase(task, phase);
    this.state.currentTask = nextTask;
    await this.appendTaskPointer(session, nextTask);
    this.emitIfCurrent(runId, { type: "task-phase-change", task: nextTask });
    this.emitIfCurrent(runId, { type: "task-update", task: nextTask });
    return nextTask;
  }

  private async blockTask(runId: number, session: SessionManager, task: TaskState): Promise<void> {
    const blockedTask = advanceTaskPhase(task, "blocked");
    this.state.currentTask = blockedTask;
    await this.appendTaskPointer(session, blockedTask);
    this.emitIfCurrent(runId, {
      type: "loop-detected",
      reason: "Repeated tool or assistant output detected.",
      task: blockedTask
    });
    this.emitIfCurrent(runId, { type: "task-update", task: blockedTask });
  }

  private async compressSessionIfNeeded(context: TaskRunContext): Promise<void> {
    if (!shouldCompressMessages(this.state.messages)) {
      return;
    }

    const compression = compressConversation(this.state.messages, context.model);
    if (compression.result.replacedMessageCount === 0) {
      return;
    }

    this.state.messages = compression.messages;
    await context.session.appendSessionCompression(compression.result);
    this.emitIfCurrent(context.runId, { type: "session-compressed", result: compression.result });
  }

  private async runTaskTurn(context: TaskRunContext, task: TaskState): Promise<ConversationMessage[]> {
    const memoryContext = await this.loadMemoryContextForTaskTurn(context);
    const skillsContext = await this.loadSkillsContextForTaskTurn(task.goal);
    const channelContext = await this.loadChannelCapabilityContext(context.input, context.channel);
    context.channelContext = channelContext;
    context.channelActionRequirement = channelContext?.requiredAction
      ? {
        nativeActionRequired: channelContext.requiredAction.required,
        action: channelContext.requiredAction.action,
        reason: channelContext.requiredAction.reason,
        textOnlyFallbackAllowed: channelContext.requiredAction.textOnlyFallbackAllowed,
      }
      : inferChannelNativeActionRequirement(context.input, channelContext);
    const todoRecord = await this.state.taskTodoStore.get(task.taskId);
    context.taskTodoRecord = todoRecord;
    this.state.currentTodoRecord = todoRecord ?? undefined;
    if (todoRecord) {
      task.currentTodoMemoryId = todoRecord.id;
    }
    const tools = await this.createToolsForRun(context, task);
    const turnPlan = buildTaskTurnPlan(task, todoRecord, context.interactionMode);

    if (turnPlan.phase === "verify") {
      this.emitIfCurrent(context.runId, { type: "task-verify-start", task });
    }
    this.emitIfCurrent(context.runId, { type: "assistant-start" });
    const taskContext = [
      this.buildTaskContextForRun(task, todoRecord, context.interactionMode),
      context.extraTaskContext ?? "",
      turnPlan.prompt,
      this.buildChannelReplyFormattingRules(channelContext),
      this.buildChannelReplyInstructions(channelContext),
      this.buildChannelPlatformContext(channelContext),
      context.channelActionRequirement
        ? defaultPromptRenderer.render("agent/required_channel_action", {
          native_action_required: context.channelActionRequirement.nativeActionRequired,
          action: context.channelActionRequirement.action,
          reason: context.channelActionRequirement.reason,
          text_only_fallback_allowed: context.channelActionRequirement.textOnlyFallbackAllowed,
        })
        : "",
      context.channelActionFeedback
        ? defaultPromptRenderer.render("agent/channel_action_retry_feedback", {
          feedback: context.channelActionFeedback,
        })
        : "",
    ].filter(Boolean).join("\n");
    const assembledPrompt = await assemblePromptContext({
      cwd: this.cwd,
      sessionId: context.session.sessionId,
      sessionStartedAt: this.state.sessionLoadedAt,
      profileName: this.state.profileName,
      model: context.model,
      thinkingLevel: this.state.thinkingLevel,
      verificationMode: task.verification.mode,
      sandboxMode: context.sandboxMode,
      approvalPolicy: context.approvalPolicy,
      autoApprove: this.isApprovalAutoApproved(context.approvalPolicy),
      config: this.state.config,
      taskContext,
      memoryContext,
      skillsContext,
      memoryPlan: collapseRecallAccumulator(context.recallAccumulator)
    });
    this.state.latestContextReport = assembledPrompt.report;

    const newMessages = await runConversation({
      model: context.model,
      systemPrompt: assembledPrompt.systemPrompt,
      messages: [...this.state.messages],
      tools,
      thinkingLevel: this.state.thinkingLevel,
      maxSteps: task.lease?.maxSteps ?? this.maxSteps,
      emit: (event) => this.emitIfCurrent(context.runId, event),
      signal: context.controller.signal
    });

    await this.appendTurnMessages(context, newMessages);
    return newMessages;
  }

  private async loadMemoryContextForTaskTurn(context: TaskRunContext): Promise<string> {
    const blocks: string[] = [];
    let retrievedItems: RetrievedContextItem[] = [];

    if (this.state.config.memory.enabled && this.state.config.memory.autoInject) {
      const retrievedContext = await this.recallInjectedMemoryContext();
      retrievedItems = retrievedContext.items;
      if (retrievedContext.localPlan) {
        if (retrievedContext.localPlan.selectedIds.length > 0) {
          mergeRecallPlan(context.recallAccumulator, retrievedContext.localPlan);
          await context.session.appendMemoryReference(retrievedContext.localPlan, "auto");
          this.emitIfCurrent(context.runId, { type: "memory-recalled", plan: retrievedContext.localPlan, reason: "auto" });
          if (retrievedContext.contextBlock.trim()) {
            blocks.push(retrievedContext.contextBlock);
          }
        }
      } else if (retrievedContext.contextBlock.trim() || retrievedContext.items.length > 0) {
        blocks.push(retrievedContext.contextBlock);
      }
    }

    const structuredMemoryContext = await this.buildStructuredMemoryContext(
      userContentToPlainText(context.userMessage.content),
      retrievedItems,
    );
    if (structuredMemoryContext) {
      blocks.push(structuredMemoryContext);
    }

    return blocks.join("\n\n");
  }

  private async loadSkillsContextForTaskTurn(prompt: string): Promise<string> {
    const skills = await loadAvailableSkills(this.cwd);
    return renderSkillsContext(skills, prompt, this.cwd);
  }

  private async loadChannelCapabilityContext(
    input: TaskInput,
    channel: ToolExecutionChannel | undefined,
  ): Promise<ChannelCapabilityContext | null> {
    if (!this.channelCapabilityProvider?.supportsChannel(channel) || !channel) {
      return null;
    }

    return this.channelCapabilityProvider.buildContext(input, channel, this.state.messages);
  }

  private buildChannelReplyInstructions(context: ChannelCapabilityContext | null): string {
    if (!context) {
      return "";
    }

    return defaultPromptRenderer.render("agent/channel_reply_instructions", {
      has_actions_or_store_resources: context.actions.length > 0 || context.storeResources.length > 0,
      actions_text: context.actions.join(", ") || "<none>",
      store_resources_text: context.storeResources.join(", ") || "<none>",
      current_resource_available: context.currentResource?.available ?? false,
      current_resource_kind: context.currentResource?.kind,
      recommended_action: context.recommendedAction,
      recommended_action_payload_text: context.recommendedAction?.payload
        ? formatRecommendedChannelActionPayload(context.recommendedAction.payload)
        : "",
      missing_store_resource: context.store && !context.store.exists ? context.store.resource : "",
      related_store_search_text: context.currentResource?.kind === "sticker"
        && context.currentResource?.attributes?.setName
        && context.store?.searchSupported
        ? `When the user asks for another sticker from the same set, first call channel_store(resource="${context.store.resource}", action="search", entry={ setName: "${context.currentResource.attributes.setName}", excludeFileId: "${context.currentResource.attributes.fileId ?? ""}" }) and then send a different fileId with channel_action.`
        : "",
      store_upsert_text: context.store
        ? `Persist reusable future sources with channel_store(resource="${context.store.resource}", action="upsert", ...).`
        : "",
      notes: context.notes ?? [],
    });
  }

  private buildChannelReplyFormattingRules(context: ChannelCapabilityContext | null): string {
    if (!context?.replyFormattingRules?.length) {
      return "";
    }

    return defaultPromptRenderer.render("agent/channel_reply_format_rules", {
      rules: context.replyFormattingRules,
    });
  }

  private buildChannelPlatformContext(context: ChannelCapabilityContext | null): string {
    if (!context) {
      return "";
    }

    return defaultPromptRenderer.render("agent/channel_platform_context", {
      channel: context.channel,
      actions_text: context.actions.join(", ") || "<none>",
      store_resources_text: context.storeResources.join(", ") || "<none>",
      store: context.store,
      current_resource: context.currentResource,
      current_resource_attributes: Object.entries(context.currentResource?.attributes ?? {}).map(([key, value]) => ({ key, value })),
      required_action: context.requiredAction,
      recommended_action: context.recommendedAction,
      recommended_action_payload: Object.entries(context.recommendedAction?.payload ?? {}).map(([key, value]) => ({ key, value })),
    });
  }

  private buildInspectableTaskContext(goal: string): string {
    const promptGoal = goal.trim();
    if (this.state.currentTask) {
      return buildTaskContext(this.state.currentTask, this.state.currentTodoRecord);
    }
    if (!promptGoal) {
      return "";
    }
    return defaultPromptRenderer.render("agent/task_context_preview", {
      goal: promptGoal,
      verification_mode: this.verificationMode ?? "light",
    });
  }

  private buildTaskContextForRun(
    task: TaskState,
    todoRecord: TaskTodoRecord | null,
    interactionMode: "default" | "channel_chat" | "curiosity",
  ): string {
    if (interactionMode === "curiosity") {
      return defaultPromptRenderer.render("agent/task_context_curiosity", {
        goal: task.goal,
        phase: task.phase,
        attempts: task.attempts,
        origin: task.origin ?? "user",
        autonomy_intent: task.parentIntentId,
        lease: task.lease,
      });
    }

    if (interactionMode !== "channel_chat") {
      return buildTaskContext(task, todoRecord);
    }

    const verificationLine =
      task.verification.mode === "none"
        ? "Verification: not required"
        : `Verification: ${task.verification.passed ? "passed" : task.verification.reason ?? "pending"}`;
    return defaultPromptRenderer.render("agent/task_context_channel_chat", {
      goal: task.goal,
      phase: task.phase,
      attempts: task.attempts,
      verification_line: verificationLine,
      origin: task.origin ?? "user",
      autonomy_intent: task.parentIntentId,
      lease: task.lease,
    });
  }

  private async createToolsForRun(context: TaskRunContext, task: TaskState) {
    const policy = await this.createPermissionPolicy(context.channel, context.approvalPolicy, context.sandboxMode);
    const toolPermissionOptions = {
      sessionId: context.session.sessionId,
      channel: context.channel,
      requestApproval: (request: ApprovalRequest) => this.requestApproval(request, context.approvalPolicy),
      requestInstallApproval: (request: ApprovalRequest) => this.requestExplicitApproval(request),
      emit: (event: { type: "approval-request"; request: ApprovalRequest } | { type: "approval-result"; toolName: string; approved: boolean; reason?: string }) =>
        this.emitIfCurrent(context.runId, event),
    } as const;
    const wrappedToolOptions = {
      ...toolPermissionOptions,
      policy,
      cwd: this.cwd,
    } as const;
    const protectedTools = context.interactionMode === "channel_chat"
      ? this.buildChannelChatProtectedTools(policy, toolPermissionOptions, context.channel)
      : context.interactionMode === "curiosity"
        ? this.buildCuriosityProtectedTools(policy, toolPermissionOptions)
        : createProtectedCodingTools(this.cwd, {
          ...toolPermissionOptions,
          policy,
        });
    const writeTodosTool = context.interactionMode === "channel_chat" || context.interactionMode === "curiosity"
      ? null
      : createWriteTodosTool({
        cwd: this.cwd,
        taskId: task.taskId,
        goal: task.goal,
        sessionId: context.session.sessionId,
        branchHeadId: context.session.getHeadId(),
        verificationMode: task.verification.mode,
        store: this.state.taskTodoStore,
        onUpdated: (record) => {
          context.taskTodoRecord = record;
          context.taskTodosDirty = true;
          this.state.currentTodoRecord = record ?? undefined;
          this.state.currentTask = {
            ...(this.state.currentTask ?? task),
            currentTodoMemoryId: record?.id
          };
          if (record) {
            void context.session.appendTaskPointer({
              taskId: task.taskId,
              todoMemoryId: record.id,
              goal: task.goal,
              phase: this.state.currentTask?.phase ?? task.phase,
              attempts: this.state.currentTask?.attempts ?? task.attempts,
              verification: this.state.currentTask?.verification ?? task.verification,
              origin: this.state.currentTask?.origin ?? task.origin,
              parentIntentId: this.state.currentTask?.parentIntentId ?? task.parentIntentId,
              lease: this.state.currentTask?.lease ?? task.lease
            });
            this.emitIfCurrent(context.runId, { type: "task-todos-updated", record });
          } else {
            this.emitIfCurrent(context.runId, { type: "task-todos-cleared", taskId: task.taskId });
          }
        }
      });
    const channelActionTool = context.interactionMode === "channel_chat"
      && context.channel && this.channelCapabilityProvider?.supportsChannel(context.channel)
      && this.channelCapabilityProvider.listAvailableActions(context.channel).length > 0
      ? wrapToolWithPermissions(createChannelActionTool({
        channel: context.channel,
        executeChannelAction: (request, callContext) =>
          this.channelCapabilityProvider!.executeAction(request, callContext),
        availableActionsDescription: `Available actions for this run: ${context.channelContext?.actions.join(", ") || "<none>"}.`,
        recommendedActionDescription: context.channelContext?.recommendedAction
          ? `Recommended action for this turn: ${context.channelContext.recommendedAction.action}${context.channelContext.recommendedAction.targetId ? ` targetId=\"${context.channelContext.recommendedAction.targetId}\"` : ""}${context.channelContext.recommendedAction.payload ? ` ${formatRecommendedChannelActionPayload(context.channelContext.recommendedAction.payload)}` : ""}.`
          : undefined,
      }), wrappedToolOptions)
      : null;
    const channelStoreTool = context.interactionMode === "channel_chat"
      && context.channel && this.channelCapabilityProvider?.supportsChannel(context.channel)
      && this.channelCapabilityProvider.listStoreResources(context.channel).length > 0
      ? wrapToolWithPermissions(createChannelStoreTool({
        channel: context.channel,
        executeChannelStore: (request, callContext) =>
          this.channelCapabilityProvider!.executeStore(request, callContext),
      }), wrappedToolOptions)
      : null;
    const tools = [
      ...(writeTodosTool ? [writeTodosTool] : []),
      ...(channelActionTool ? [channelActionTool] : []),
      ...(channelStoreTool ? [channelStoreTool] : []),
      ...protectedTools,
    ];
    context.allowedToolNames = tools.map((toolDef) => toolDef.name);
    return tools;
  }

  private buildChannelChatProtectedTools(
    policy: DefaultPermissionPolicy,
    toolPermissionOptions: {
      sessionId: string;
      channel?: ToolExecutionChannel;
      requestApproval: (request: ApprovalRequest) => Promise<boolean>;
      emit: (event: { type: "approval-request"; request: ApprovalRequest } | { type: "approval-result"; toolName: string; approved: boolean; reason?: string }) => void;
    },
    channel: ToolExecutionChannel | undefined,
  ) {
    if (!this.canExposeChannelChatBash(policy, channel)) {
      return [];
    }

    return [createProtectedBashTool(this.cwd, {
      ...toolPermissionOptions,
      policy,
    })];
  }

  private buildCuriosityProtectedTools(
    policy: DefaultPermissionPolicy,
    toolPermissionOptions: {
      sessionId: string;
      channel?: ToolExecutionChannel;
      requestApproval: (request: ApprovalRequest) => Promise<boolean>;
      requestInstallApproval: (request: ApprovalRequest) => Promise<boolean>;
      emit: (event: { type: "approval-request"; request: ApprovalRequest } | { type: "approval-result"; toolName: string; approved: boolean; reason?: string }) => void;
    },
  ) {
    return [
      wrapToolWithPermissions(createReadTool(this.cwd), {
        ...toolPermissionOptions,
        cwd: this.cwd,
        policy,
      }),
      createProtectedBashTool(this.cwd, {
        ...toolPermissionOptions,
        policy,
        requestInstallApproval: toolPermissionOptions.requestInstallApproval,
      }),
    ];
  }

  private async createPermissionPolicy(
    channel: ToolExecutionChannel | undefined,
    approvalPolicy: ApprovalPolicy,
    sandboxMode: SandboxMode
  ): Promise<DefaultPermissionPolicy> {
    const sensitiveActionMode = this.state.config.settings.sensitiveActionMode;
    if (channel?.platform !== "telegram") {
      return new DefaultPermissionPolicy({
        sensitiveActionMode,
        approvalPolicy,
        sandboxMode,
      });
    }

    const approval = this.state.config.channels.telegram.approval;
    const allowlistedChannels = approval.allowChats.map((chatId) => ({
      platform: "telegram",
      kind: chatId.startsWith("-") ? "channel" : "dm",
      id: chatId,
    }) satisfies ToolExecutionChannel);
    const implicitTelegramDmChannels = channel.kind === "dm"
      ? await this.loadTelegramImplicitApprovalChannels()
      : [];

    return new DefaultPermissionPolicy({
      allowlistedChannels: dedupeToolExecutionChannels([
        ...allowlistedChannels,
        ...implicitTelegramDmChannels,
      ]),
      commandDenylist: approval.commandDenylist,
      sensitiveActionMode,
      approvalPolicy,
      sandboxMode,
    });
  }

  private canExposeChannelChatBash(
    policy: DefaultPermissionPolicy,
    channel: ToolExecutionChannel | undefined,
  ): boolean {
    return channel?.platform === "telegram" && policy.isAllowlistedChannel(channel);
  }

  private async loadTelegramImplicitApprovalChannels(): Promise<ToolExecutionChannel[]> {
    const storeAllowFrom = await this.readTelegramAllowFromStore();
    return mergeTelegramAllowFrom(this.state.config.channels.telegram, storeAllowFrom).map((senderId) => ({
        platform: "telegram",
        kind: "dm",
        id: senderId,
      }) satisfies ToolExecutionChannel);
  }

  private async readTelegramAllowFromStore(): Promise<string[]> {
    const store = new MonoConfigStore(this.cwd);
    const file = await readJsonFile<TelegramAllowFromStoreFile>(
      join(store.paths.globalStateDir, "telegram", "allowFrom.json")
    );
    return file?.allowFrom?.map(String).filter(Boolean) ?? [];
  }

  private async appendTurnMessages(context: TaskRunContext, newMessages: ConversationMessage[]): Promise<void> {
    const sanitizedMessages = guardMessagesBeforeSessionPersist({
      model: context.model,
      messages: newMessages,
      allowedToolNames: context.allowedToolNames,
    });
    for (const message of sanitizedMessages) {
      if (!this.isRunCurrent(context.runId)) {
        return;
      }
      this.state.messages.push(message);
      context.taskMessages.push(message);
      await context.session.appendMessage(message);
      this.emitIfCurrent(context.runId, { type: "message", message });
    }
  }

  private createTaskResult(
    task: TaskState,
    messages: ConversationMessage[],
    loopDetected: boolean,
    leaseExceeded: boolean,
    channelActionRequirement?: {
      nativeActionRequired: boolean;
      action?: string;
      reason?: string;
      textOnlyFallbackAllowed: boolean;
    },
  ): TaskResult {
    const nativeActionSatisfied = channelActionRequirement?.nativeActionRequired
      ? didSatisfyChannelActionRequirement(messages, channelActionRequirement.action)
      : true;

    const status = !nativeActionSatisfied
      ? "incomplete"
      : leaseExceeded
        ? "blocked"
      : loopDetected
        ? "blocked"
        : task.verification.mode === "none" || task.verification.passed
          ? "done"
          : task.attempts >= this.maxTurns
            ? "incomplete"
            : "done";

    return {
      taskId: task.taskId,
      todoMemoryId: task.currentTodoMemoryId,
      status,
      summary: buildTaskSummary(task, messages, status),
      turns: task.attempts,
      verification: task.verification,
      ...(channelActionRequirement
        ? {
          channelDelivery: {
            nativeActionRequired: channelActionRequirement.nativeActionRequired,
            action: channelActionRequirement.action,
            reason: channelActionRequirement.reason,
            satisfied: nativeActionSatisfied,
          },
        }
        : {}),
      messages
    };
  }

  private async persistTaskMemory(
    context: TaskRunContext,
    task: TaskState,
    result: TaskResult,
    options: {
      loopDetected: boolean;
      leaseExceeded: boolean;
      diagnosis: ReturnType<typeof diagnoseTaskOutcome>;
    }
  ): Promise<void> {
    if (context.origin !== "user" && this.state.config.memory.v2.enabled) {
      const comparisonKey = context.autonomyIntent
        ? buildHeartbeatReplyComparisonKey(context.autonomyIntent)
        : `${context.origin}:${task.goal}`;
      const previousNormalizedText = await this.loadPreviousHeartbeatReplyText(comparisonKey);
      const evaluation = evaluateHeartbeatReply({
        messages: result.messages,
        previousNormalizedText,
      });
      context.heartbeatReplyEvaluation = evaluation;
      await this.state.structuredMemoryStore.appendHeartbeatReplyRecord(buildHeartbeatReplyRecord({
        sessionId: context.session.sessionId,
        intentId: context.autonomyIntent?.id,
        comparisonKey,
        evaluation,
      }));
      if (evaluation.status !== "sent") {
        return;
      }
    }

    let memoryRecord: MemoryRecord | null = null;
    if (context.taskMessages.length > 0 && this.state.config.memory.enabled) {
      memoryRecord = await this.compactAndPersistTurn({
        userMessage: context.userMessage,
        messages: context.taskMessages,
        recallPlan: collapseRecallAccumulator(context.recallAccumulator)
      });
      if (memoryRecord) {
        await context.session.appendMemoryRecord(memoryRecord);
        await this.syncConfiguredMemoryBackends(memoryRecord, context.session);
        this.emitIfCurrent(context.runId, { type: "memory-persisted", record: memoryRecord });
      }
    }

    if (!this.state.config.memory.v2.enabled) {
      return;
    }

    const primaryEntityId = resolvePrimaryEntityId(this.state.config.memory.v2);
    if (context.taskMessages.length > 0) {
      const structuredTurn = await persistStructuredMemoryTurn({
        config: this.state.config.memory.v2,
        store: this.state.structuredMemoryStore,
        entityId: primaryEntityId,
        userMessage: userContentToPlainText(context.userMessage.content),
        assistantMessages: context.taskMessages,
        origin:
          context.origin === "user"
            ? "user_task"
            : context.autonomyIntent?.kind === "self_reflection"
              ? "self_reflection"
              : "heartbeat",
        sessionId: context.session.sessionId,
        branchHeadId: context.session.getHeadId()
      });
      const structuredResult = await runStructuredMemoryConsolidation({
        config: this.state.config.memory.v2,
        store: this.state.structuredMemoryStore,
        entityId: primaryEntityId
      });
      await this.syncStructuredMemoryBackends([
        {
          id: structuredTurn.event.id,
          scope: "episodic",
          title: "episodic event",
          summary: structuredTurn.event.summary,
          detailLines: structuredTurn.event.messages
        },
        ...structuredResult.preferences.items.slice(0, 3).map((item) => ({
          id: `pref-${primaryEntityId}-${item.key}`,
          scope: "other" as const,
          title: item.key,
          summary: item.summary,
          detailLines: item.evidenceIds
        })),
        ...structuredResult.inferences.slice(0, 2).map((item) => ({
          id: item.id,
          scope: "other" as const,
          title: item.trait,
          summary: item.summary,
          detailLines: item.basedOn
        })),
        ...structuredResult.conflicts.slice(0, 2).map((item) => ({
          id: item.id,
          scope: "other" as const,
          title: `conflict:${item.field}`,
          summary: item.reason,
          detailLines: item.evidenceIds
        }))
      ]);
    }

    await this.integrateTaskFeedback(primaryEntityId, task, result, options, context);
  }

  private async finishTask(runId: number, session: SessionManager, task: TaskState, result: TaskResult): Promise<TaskState> {
    const finalPhase =
      result.status === "done"
        ? "done"
        : result.status === "aborted"
          ? "aborted"
          : result.status === "incomplete"
            ? "incomplete"
            : "blocked";
    const finalTask = advanceTaskPhase(task, finalPhase);
    if (this.state.currentTodoRecord) {
      finalTask.currentTodoMemoryId = this.state.currentTodoRecord?.id;
    }
    this.state.currentTask = finalTask;
    await this.appendTaskPointer(session, finalTask);
    if (this.state.currentTodoRecord) {
      const updatedTodo = createTaskTodoRecord({
        taskId: this.state.currentTodoRecord.taskId,
        goal: this.state.currentTodoRecord.goal,
        sessionId: this.state.currentTodoRecord.sessionId,
        branchHeadId: this.state.currentTodoRecord.branchHeadId,
        cwd: this.cwd,
        verificationMode: this.state.currentTodoRecord.verificationMode,
        existing: this.state.currentTodoRecord,
        todos: this.state.currentTodoRecord.todos,
        status:
          result.status === "done"
            ? "completed"
            : result.status === "blocked"
              ? "blocked"
              : result.status === "aborted"
                ? "cancelled"
                : "active",
        summary: result.summary
      });
      await this.state.taskTodoStore.upsert(updatedTodo);
      this.state.currentTodoRecord = updatedTodo;
      this.emitIfCurrent(runId, { type: "task-todos-updated", record: updatedTodo });
    }
    await session.appendTaskSummary(result);
    this.emitIfCurrent(runId, { type: "task-update", task: finalTask });
    return finalTask;
  }

  private async appendTaskPointer(session: SessionManager, task: TaskState): Promise<void> {
    await session.appendTaskPointer({
      taskId: task.taskId,
      todoMemoryId: task.currentTodoMemoryId,
      goal: task.goal,
      phase: task.phase,
      attempts: task.attempts,
      verification: task.verification,
      origin: task.origin,
      parentIntentId: task.parentIntentId,
      lease: task.lease
    });
  }

  private async loadCurrentTaskForHead(session: SessionManager, branchHeadId?: string): Promise<TaskState | undefined> {
    const entries = await session.readEntries();
    const targetHeadId = branchHeadId ?? session.getHeadId();
    if (!targetHeadId) {
      return undefined;
    }

    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const reachable = new Set<string>();
    let current = byId.get(targetHeadId);
    while (current) {
      reachable.add(current.id);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }

    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (!entry || !reachable.has(entry.id)) {
        continue;
      }
      if (entry.entryType === "task_pointer") {
        const payload = entry.payload as {
          taskId: string;
          todoMemoryId?: string;
          goal: string;
          phase: TaskState["phase"];
          attempts: number;
          verification: TaskState["verification"];
          origin?: TaskOrigin;
          parentIntentId?: string;
          lease?: TaskLease;
        };
        return {
          taskId: payload.taskId,
          goal: payload.goal,
          phase: payload.phase,
          attempts: payload.attempts,
          verification: payload.verification,
          currentTodoMemoryId: payload.todoMemoryId,
          origin: payload.origin,
          parentIntentId: payload.parentIntentId,
          lease: payload.lease
        };
      }
      if (entry.entryType === "task_state") {
        const legacy = entry.payload as TaskState & { todos?: TaskTodoRecord["todos"] };
        const nextTask: TaskState = {
          taskId: legacy.taskId,
          goal: legacy.goal,
          phase: legacy.phase,
          attempts: legacy.attempts,
          verification: legacy.verification,
          currentTodoMemoryId: legacy.currentTodoMemoryId,
          origin: legacy.origin,
          parentIntentId: legacy.parentIntentId,
          lease: legacy.lease
        };
        if (legacy.todos && legacy.todos.length > 0) {
          const existing = await this.state.taskTodoStore.get(legacy.taskId);
          if (!existing) {
            const record = createTaskTodoRecord({
              taskId: legacy.taskId,
              goal: legacy.goal,
              sessionId: session.sessionId,
              branchHeadId,
              cwd: this.cwd,
              verificationMode: legacy.verification.mode,
              todos: legacy.todos
            });
            await this.state.taskTodoStore.upsert(record);
            nextTask.currentTodoMemoryId = record.id;
            this.state.currentTodoRecord = record;
          }
        }
        return nextTask;
      }
    }

    return undefined;
  }
}

function dedupeToolExecutionChannels(channels: ToolExecutionChannel[]): ToolExecutionChannel[] {
  const unique = new Map<string, ToolExecutionChannel>();

  for (const channel of channels) {
    unique.set(`${channel.platform}:${channel.kind}:${channel.id}`, channel);
  }

  return [...unique.values()];
}

function inferChannelNativeActionRequirement(
  input: TaskInput,
  context: ChannelCapabilityContext | null,
): { nativeActionRequired: boolean; action?: string; reason?: string; textOnlyFallbackAllowed: boolean } | undefined {
  if (!context || context.actions.length === 0) {
    return undefined;
  }

  const text = (input.text ?? "").trim().toLowerCase();
  const currentKind = context.currentResource?.kind?.toLowerCase();
  const currentSource = context.currentResource?.source;

  if (!text) {
    if (context.currentResource?.available && currentSource === "current_input" && currentKind && context.actions.includes(currentKind)) {
      return {
        nativeActionRequired: true,
        action: currentKind,
        reason: "current_input_native_resource",
        textOnlyFallbackAllowed: false,
      };
    }
    return undefined;
  }

  const hasSendVerb = /\b(send|reply|use)\b/.test(text) || /发|回|用/.test(text);
  const rejectsText = /don't use text|do not use text|not text|不要用文本|不要文本/.test(text);
  const rejectsEmoji = /not emoji|don't use emoji|do not use emoji|不是emoji|不要emoji/.test(text);
  const refersToCurrentResource = /这个|这套|this|same/.test(text) && context.currentResource?.available;
  const searchableActions = context.actions.filter((action) => action.toLowerCase() !== "send");

  if (!context.currentResource?.available || !currentKind || !searchableActions.includes(currentKind)) {
    return undefined;
  }

  const candidateAction = [
    currentKind && searchableActions.includes(currentKind) && text.includes(currentKind) ? currentKind : null,
    currentKind && context.currentResource?.available && refersToCurrentResource ? currentKind : null,
  ].find((value): value is string => Boolean(value));

  if (!candidateAction) {
    return undefined;
  }

  if (!hasSendVerb && !rejectsText && !rejectsEmoji) {
    return undefined;
  }

  return {
    nativeActionRequired: true,
    action: candidateAction,
    reason: refersToCurrentResource && currentSource === "recent_history"
      ? "recent_history_reference"
      : refersToCurrentResource && currentSource === "current_input"
        ? "current_input_native_resource"
        : "explicit_native_send",
    textOnlyFallbackAllowed: false,
  };
}

function didSatisfyChannelActionRequirement(
  messages: ConversationMessage[],
  action: string | undefined,
): boolean {
  return messages.some((message) =>
    message.role === "tool"
      && message.toolName === "channel_action"
      && !message.isError
      && typeof message.input === "object"
      && message.input !== null
      && didChannelActionToolSucceed(message)
      && (action
        ? String((message.input as { action?: string }).action ?? "").trim().toLowerCase() === action.trim().toLowerCase()
        : true)
  );
}

function buildChannelActionRetryFeedback(
  requirement: {
    nativeActionRequired: boolean;
    action?: string;
    reason?: string;
    textOnlyFallbackAllowed: boolean;
  },
  context: ChannelCapabilityContext | null | undefined,
): string {
  const lines = [
    "Previous turn failed to invoke the required native channel action.",
    "Do not answer with plain text for this turn.",
    requirement.action
      ? `Call channel_action with action="${requirement.action}".`
      : "Call channel_action with the required native action.",
  ];

  if (requirement.reason) {
    lines.push(`Requirement reason: ${requirement.reason}.`);
  }
  if (context?.recommendedAction?.targetId) {
    lines.push(`Recommended targetId="${context.recommendedAction.targetId}".`);
  }
  if (context?.recommendedAction?.payload && Object.keys(context.recommendedAction.payload).length > 0) {
    lines.push(`Recommended ${formatRecommendedChannelActionPayload(context.recommendedAction.payload)}.`);
  }

  return lines.join(" ");
}

function formatRecommendedChannelActionPayload(payload: Record<string, string>): string {
  return Object.entries(payload)
    .map(([key, value]) => `payload.${key}="${value}"`)
    .join(" ");
}

function didChannelActionToolSucceed(message: Extract<ConversationMessage, { role: "tool" }>): boolean {
  if (typeof message.content !== "string") {
    return false;
  }

  try {
    const parsed = JSON.parse(message.content) as { ok?: unknown };
    return parsed.ok === true;
  } catch {
    return false;
  }
}
