import {
  type ApprovalRequest,
  type ChannelCapabilityContext,
  type ChannelCapabilityProvider,
  type RuntimeEvent,
  type ContextAssemblyReport,
  type ConversationMessage,
  hasTaskInputContent,
  type MemoryRecallPlan,
  type MemoryRecord,
  type MemorySearchMatch,
  type MonoConfigSummary,
  type ResolvedMonoConfig,
  type SessionNodeSummary,
  type SessionSummary,
  readJsonFile,
  mergeTelegramAllowFrom,
  supportsImageAttachments,
  type TaskInput,
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
import { readFile } from "node:fs/promises";
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
  selectMemoryIdsByKeyword,
  selectMemoryIdsBySession,
  type MemoryRetrievalProvider,
  type RetrievedContextItem,
  type RetrievedContext,
  type MemoryStore
} from "@mono/memory";
import { SessionManager } from "@mono/session";
import {
  createProtectedCodingTools,
  createChannelActionTool,
  createChannelStoreTool,
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
import { createWriteTodosTool } from "./task-todo-tool.js";

interface TaskRunContext {
  runId: number;
  controller: AbortController;
  session: SessionManager;
  model: UnifiedModel;
  interactionMode: "default" | "channel_chat";
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
}

export interface RunTaskOptions {
  channel?: ToolExecutionChannel;
  interactionMode?: "default" | "channel_chat";
  extraTaskContext?: string;
}

export interface AgentOptions {
  cwd?: string;
  model?: string;
  profile?: string;
  baseURL?: string;
  thinkingLevel?: ThinkingLevel;
  maxSteps?: number;
  maxTurns?: number;
  verificationMode?: VerificationMode;
  autoApprove?: boolean;
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
}

export interface ConfiguredModelProfile {
  name: string;
  model: UnifiedModel;
}

interface TelegramAllowFromStoreFile {
  version?: number;
  allowFrom?: string[];
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

export class Agent {
  private readonly cwd: string;
  private readonly registry: ModelRegistry;
  private readonly listeners = new Set<(event: RuntimeEvent) => void>();
  private readonly maxSteps: number;
  private readonly maxTurns: number;
  private readonly autoApprove: boolean;
  private readonly verificationMode?: VerificationMode;
  private requestApprovalHandler?: (request: ApprovalRequest) => Promise<boolean>;
  private channelCapabilityProvider?: ChannelCapabilityProvider;
  private initialized = false;
  private registryLoaded = false;
  private modelSelection?: string;
  private profileSelection?: string;
  private baseURLOverride?: string;
  private continueSession: boolean;
  private requestedThinkingLevel: ThinkingLevel;
  private activeRun?: { id: number; controller: AbortController };
  private nextRunId = 1;
  private readonly memoryCompactor = new DeterministicMemoryCompactor();

  state!: AgentState;

  constructor(options: AgentOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.registry = new ModelRegistry({ cwd: this.cwd });
    this.maxSteps = options.maxSteps ?? 8;
    this.maxTurns = options.maxTurns ?? 3;
    this.verificationMode = options.verificationMode;
    this.autoApprove = options.autoApprove ?? false;
    this.requestApprovalHandler = options.requestApproval;
    this.channelCapabilityProvider = options.channelCapabilityProvider;
    this.modelSelection = options.model;
    this.profileSelection = options.profile;
    this.baseURLOverride = options.baseURL;
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
        maxTurns: this.maxTurns
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

      for (let attempt = 0; attempt < this.maxTurns; attempt += 1) {
        if (!this.isRunCurrent(runContext.runId)) {
          return this.buildAbortedTaskResult(runContext.taskMessages);
        }

        await this.compressSessionIfNeeded(runContext);
        const newMessages = await this.runTaskTurn(runContext, task);
        if (!this.isRunCurrent(runContext.runId)) {
          return this.buildAbortedTaskResult(runContext.taskMessages);
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
        runContext.channelActionRequirement,
      );
      await this.persistTaskMemory(runContext);
      task = await this.finishTask(runContext.runId, runContext.session, task, result);
      this.emitIfCurrent(runContext.runId, { type: "task-summary", result });
      this.emitIfCurrent(runContext.runId, { type: "run-end", messages: runContext.taskMessages });
      return result;
    } catch (error) {
      if (runContext.controller.signal.aborted || this.isAbortError(error)) {
        this.markTaskAborted();
        this.emitIfCurrent(runContext.runId, { type: "run-aborted", reason: "user" });
        return this.buildAbortedTaskResult([]);
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
    return this.state.currentTask;
  }

  getCurrentTodoRecord(): TaskTodoRecord | undefined {
    return this.state.currentTodoRecord;
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
      autoApprove: this.autoApprove,
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

  private async requestApproval(request: ApprovalRequest): Promise<boolean> {
    if (this.activeRun?.controller.signal.aborted) {
      return false;
    }
    if (this.autoApprove) {
      return true;
    }
    if (!this.requestApprovalHandler) {
      return false;
    }
    return this.requestApprovalHandler(request);
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

    const [identityRecord, projectProfile] = await Promise.all([
      this.state.structuredMemoryStore.getSelfIdentity(),
      this.state.structuredMemoryStore.getProjectProfile()
    ]);

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

  private createTaskRunContext(input: string | TaskInput, options: RunTaskOptions): TaskRunContext {
    const run = this.startRun();
    return {
      runId: run.id,
      controller: run.controller,
      session: this.state.session,
      model: this.state.model,
      interactionMode: options.interactionMode ?? "default",
      channel: options.channel,
      input: typeof input === "string" ? { text: input } : input,
      extraTaskContext: options.extraTaskContext,
      channelContext: null,
      channelActionRequirement: undefined,
      channelActionFeedback: undefined,
      userMessage: taskInputToUserMessage(input),
      taskMessages: [],
      recallAccumulator: createRecallAccumulator(),
      taskTodoRecord: null,
      taskTodosDirty: false
    };
  }

  private async beginTaskRun(context: TaskRunContext): Promise<void> {
    this.state.messages.push(context.userMessage);
    await context.session.appendMessage(context.userMessage);
    this.emitIfCurrent(context.runId, { type: "run-start", input: context.userMessage });
    this.emitIfCurrent(context.runId, { type: "message", message: context.userMessage });
  }

  private applyRunMode(task: TaskState, context: TaskRunContext): TaskState {
    if (context.interactionMode === "channel_chat") {
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
    const turnPlan = buildTaskTurnPlan(task, todoRecord);

    if (turnPlan.phase === "verify") {
      this.emitIfCurrent(context.runId, { type: "task-verify-start", task });
    }
    this.emitIfCurrent(context.runId, { type: "assistant-start" });
    const taskContext = [
      this.buildTaskContextForRun(task, todoRecord, context.interactionMode),
      context.extraTaskContext ?? "",
      turnPlan.prompt,
      this.buildChannelReplyInstructions(channelContext),
      this.buildChannelPlatformContext(channelContext),
      context.channelActionRequirement
        ? [
          "Required Channel Action:",
          `- RequestedNativeActionRequired: ${context.channelActionRequirement.nativeActionRequired ? "yes" : "no"}`,
          context.channelActionRequirement.action ? `- RequestedNativeAction: ${context.channelActionRequirement.action}` : "",
          context.channelActionRequirement.reason ? `- RequestedNativeActionReason: ${context.channelActionRequirement.reason}` : "",
          `- TextOnlyFallbackAllowed: ${context.channelActionRequirement.textOnlyFallbackAllowed ? "yes" : "no"}`,
          context.channelActionRequirement.nativeActionRequired
            ? "- A plain-text response does not satisfy this turn."
            : "",
        ].filter(Boolean).join("\n")
        : "",
      context.channelActionFeedback
        ? `Channel Action Retry Feedback:\n- ${context.channelActionFeedback}`
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
      autoApprove: this.autoApprove,
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
      maxSteps: this.maxSteps,
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

    if (context.actions.length === 0 && context.storeResources.length === 0) {
      return [
        "Channel Delivery Notes:",
        "- Write a normal user-facing reply.",
        "- The runtime may split long answers into multiple platform messages automatically when needed.",
      ].join("\n");
    }

    return [
      "Channel Delivery Notes:",
      "- Write a normal user-facing reply.",
      "- Use the channel_action tool for platform-native sends, edits, deletes, reactions, or native media actions when a direct channel action is needed.",
      "- Use the channel_store tool when the user wants to save a reusable channel-native source for future runs.",
      "- The runtime may split long answers into multiple platform messages automatically when needed.",
      `- Available channel actions: ${context.actions.join(", ") || "<none>"}.`,
      `- Available channel store resources: ${context.storeResources.join(", ") || "<none>"}.`,
      context.currentResource?.available
        ? `- Current-turn ${context.currentResource.kind} is available; prefer channel_action over placeholder text or emoji when the user wants the real platform-native resource.`
        : "",
      context.recommendedAction
        ? `- RecommendedChannelAction: ${context.recommendedAction.action} targeting ${context.recommendedAction.targetId ?? "the current conversation"}.`
        : "",
      context.recommendedAction?.payload
        ? `- RecommendedChannelActionPayload: ${formatRecommendedChannelActionPayload(context.recommendedAction.payload)}.`
        : "",
      context.store && !context.store.exists
        ? `- Missing durable store for ${context.store.resource} does not block sending the current-turn resource now.`
        : "",
      context.currentResource?.kind === "sticker"
        && context.currentResource?.attributes?.setName
        && context.store?.searchSupported
        ? `- When the user asks for another sticker from the same set, first call channel_store(resource="${context.store.resource}", action="search", entry={ setName: "${context.currentResource.attributes.setName}", excludeFileId: "${context.currentResource.attributes.fileId ?? ""}" }) and then send a different fileId with channel_action.`
        : "",
      context.store
        ? `- Persist reusable future sources with channel_store(resource="${context.store.resource}", action="upsert", ...).`
        : "",
      ...(context.notes ?? []),
    ].join("\n");
  }

  private buildChannelPlatformContext(context: ChannelCapabilityContext | null): string {
    if (!context) {
      return "";
    }

    return [
      "Channel Native Resource Context:",
      `- Channel: ${context.channel}`,
      `- AvailableChannelActions: ${context.actions.join(", ") || "<none>"}`,
      `- AvailableChannelStoreResources: ${context.storeResources.join(", ") || "<none>"}`,
      context.store ? `- Store.resource: ${context.store.resource}` : "",
      context.store?.path ? `- Store.path: ${context.store.path}` : "",
      context.store ? `- Store.exists: ${context.store.exists ? "yes" : "no"}` : "",
      context.store ? `- Store.readable: ${context.store.readable ? "yes" : "no"}` : "",
      context.store ? `- Store.entryCount: ${context.store.entryCount}` : "",
      context.store ? `- Store.searchSupported: ${context.store.searchSupported ? "yes" : "no"}` : "",
      context.currentResource ? `- CurrentTurnNativeResourceKind: ${context.currentResource.kind}` : "",
      context.currentResource ? `- CurrentTurnNativeResourceAvailable: ${context.currentResource.available ? "yes" : "no"}` : "",
      context.currentResource?.source ? `- CurrentTurnNativeResourceSource: ${context.currentResource.source}` : "",
      ...Object.entries(context.currentResource?.attributes ?? {}).map(([key, value]) => `- Resource.${key}: ${value}`),
      context.requiredAction ? `- RequiredChannelAction.required: ${context.requiredAction.required ? "yes" : "no"}` : "",
      context.requiredAction?.action ? `- RequiredChannelAction.action: ${context.requiredAction.action}` : "",
      context.requiredAction?.reason ? `- RequiredChannelAction.reason: ${context.requiredAction.reason}` : "",
      context.requiredAction ? `- RequiredChannelAction.textOnlyFallbackAllowed: ${context.requiredAction.textOnlyFallbackAllowed ? "yes" : "no"}` : "",
      context.recommendedAction ? `- RecommendedChannelAction.action: ${context.recommendedAction.action}` : "",
      context.recommendedAction?.targetId ? `- RecommendedChannelAction.targetId: ${context.recommendedAction.targetId}` : "",
      ...Object.entries(context.recommendedAction?.payload ?? {}).map(([key, value]) => `- RecommendedChannelAction.payload.${key}: ${value}`),
    ].filter(Boolean).join("\n");
  }

  private buildInspectableTaskContext(goal: string): string {
    const promptGoal = goal.trim();
    if (this.state.currentTask) {
      return buildTaskContext(this.state.currentTask, this.state.currentTodoRecord);
    }
    if (!promptGoal) {
      return "";
    }
    return [
      "<TaskContext>",
      `Goal: ${promptGoal}`,
      "Phase: preview",
      "Attempts: 0",
      `Verification: ${this.verificationMode ?? "light"}`,
      "Todos: <none>",
      "Use write_todos to create a task plan if the work becomes multi-step.",
      "</TaskContext>"
    ].join("\n");
  }

  private buildTaskContextForRun(
    task: TaskState,
    todoRecord: TaskTodoRecord | null,
    interactionMode: "default" | "channel_chat",
  ): string {
    if (interactionMode !== "channel_chat") {
      return buildTaskContext(task, todoRecord);
    }

    const verificationLine =
      task.verification.mode === "none"
        ? "Verification: not required"
        : `Verification: ${task.verification.passed ? "passed" : task.verification.reason ?? "pending"}`;
    return [
      "<TaskContext>",
      `Goal: ${task.goal}`,
      `Phase: ${task.phase}`,
      `Attempts: ${task.attempts}`,
      verificationLine,
      "Mode: channel_chat",
      "This is a live channel chat turn.",
      "Do not plan engineering work or use write_todos.",
      "Respond in-channel and prefer channel_action for required native actions.",
      "</TaskContext>",
    ].join("\n");
  }

  private async createToolsForRun(context: TaskRunContext, task: TaskState) {
    const policy = await this.createPermissionPolicy(context.channel);
    const wrappedToolOptions = {
      sessionId: context.session.sessionId,
      channel: context.channel,
      requestApproval: (request: ApprovalRequest) => this.requestApproval(request),
      emit: (event: { type: "approval-request"; request: ApprovalRequest } | { type: "approval-result"; toolName: string; approved: boolean; reason?: string }) =>
        this.emitIfCurrent(context.runId, event),
      policy,
      cwd: this.cwd,
    } as const;
    const protectedTools = context.interactionMode === "channel_chat"
      ? []
      : createProtectedCodingTools(this.cwd, {
        sessionId: context.session.sessionId,
        channel: context.channel,
        requestApproval: (request) => this.requestApproval(request),
        emit: (event) => this.emitIfCurrent(context.runId, event),
        policy,
      });
    const writeTodosTool = context.interactionMode === "channel_chat"
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
              verification: this.state.currentTask?.verification ?? task.verification
            });
            this.emitIfCurrent(context.runId, { type: "task-todos-updated", record });
          } else {
            this.emitIfCurrent(context.runId, { type: "task-todos-cleared", taskId: task.taskId });
          }
        }
      });
    const channelActionTool = context.channel && this.channelCapabilityProvider?.supportsChannel(context.channel)
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
    const channelStoreTool = context.channel && this.channelCapabilityProvider?.supportsChannel(context.channel)
      && this.channelCapabilityProvider.listStoreResources(context.channel).length > 0
      ? wrapToolWithPermissions(createChannelStoreTool({
        channel: context.channel,
        executeChannelStore: (request, callContext) =>
          this.channelCapabilityProvider!.executeStore(request, callContext),
      }), wrappedToolOptions)
      : null;
    return [
      ...(writeTodosTool ? [writeTodosTool] : []),
      ...(channelActionTool ? [channelActionTool] : []),
      ...(channelStoreTool ? [channelStoreTool] : []),
      ...protectedTools,
    ];
  }

  private async createPermissionPolicy(channel: ToolExecutionChannel | undefined): Promise<DefaultPermissionPolicy> {
    const sensitiveActionMode = this.state.config.settings.sensitiveActionMode;
    if (channel?.platform !== "telegram") {
      return new DefaultPermissionPolicy({ sensitiveActionMode });
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
    });
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
    for (const message of newMessages) {
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

  private async persistTaskMemory(context: TaskRunContext): Promise<void> {
    if (context.taskMessages.length === 0) {
      return;
    }

    let memoryRecord: MemoryRecord | null = null;
    if (this.state.config.memory.enabled) {
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

    const structuredResult = await persistStructuredMemoryTurn({
      config: this.state.config.memory.v2,
      store: this.state.structuredMemoryStore,
      entityId: resolvePrimaryEntityId(this.state.config.memory.v2),
      userMessage: userContentToPlainText(context.userMessage.content),
      assistantMessages: context.taskMessages,
      sessionId: context.session.sessionId,
      branchHeadId: context.session.getHeadId()
    });
    await this.syncStructuredMemoryBackends([
      {
        id: structuredResult.event.id,
        scope: "episodic",
        title: "episodic event",
        summary: structuredResult.event.summary,
        detailLines: structuredResult.event.messages
      },
      ...structuredResult.preferences.items.slice(0, 3).map((item) => ({
        id: `pref-${resolvePrimaryEntityId(this.state.config.memory.v2)}-${item.key}`,
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
      }))
    ]);
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
      verification: task.verification
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
        };
        return {
          taskId: payload.taskId,
          goal: payload.goal,
          phase: payload.phase,
          attempts: payload.attempts,
          verification: payload.verification,
          currentTodoMemoryId: payload.todoMemoryId
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
          currentTodoMemoryId: legacy.currentTodoMemoryId
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

  const candidateAction = [
    currentKind && searchableActions.includes(currentKind) && text.includes(currentKind) ? currentKind : null,
    currentKind && context.currentResource?.available && refersToCurrentResource ? currentKind : null,
    searchableActions.find((action) => text.includes(action.toLowerCase())) ?? null,
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
