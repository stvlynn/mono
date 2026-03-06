import {
  type ApprovalRequest,
  type ConversationMessage,
  type MemoryRecallPlan,
  type MemoryRecord,
  type MemorySearchMatch,
  type MonoConfigSummary,
  type ResolvedMonoConfig,
  type RuntimeEvent,
  type SessionNodeSummary,
  type SessionSummary,
  type TaskResult,
  type TaskState,
  type ThinkingLevel,
  type UnifiedModel,
  type UserMessage,
  type VerificationMode
} from "@mono/shared";
import { ModelRegistry, runConversation } from "@mono/llm";
import {
  DeterministicMemoryCompactor,
  FolderMemoryStore,
  buildMemoryRecordMetadata,
  createMemoryId,
  renderMemoryContext,
  selectMemoryIdsByKeyword,
  selectMemoryIdsBySession,
  type MemoryStore
} from "@mono/memory";
import { SessionManager } from "@mono/session";
import { createProtectedCodingTools, DefaultPermissionPolicy } from "@mono/tools";
import {
  buildDetailedTrace,
  collapseRecallAccumulator,
  createRecallAccumulator,
  emptyRecallPlan,
  mergeRecallPlan,
  projectKeyFromCwd,
  resolveMemoryStorePath,
  type RecallAccumulator
} from "./memory-runtime.js";
import { createDefaultSystemPrompt } from "./system-prompt.js";
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

interface TaskRunContext {
  runId: number;
  controller: AbortController;
  session: SessionManager;
  model: UnifiedModel;
  userMessage: UserMessage;
  taskMessages: ConversationMessage[];
  recallAccumulator: RecallAccumulator;
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
  currentTask?: TaskState;
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
  private initialized = false;
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

    await this.registry.load();
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
    this.state = {
      cwd: this.cwd,
      profileName: config.profileName,
      model,
      messages,
      thinkingLevel: this.requestedThinkingLevel,
      session,
      config,
      configSummary,
      memoryStore
    };
    this.initialized = true;
  }

  subscribe(listener: (event: RuntimeEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setRequestApproval(handler: (request: ApprovalRequest) => Promise<boolean>): void {
    this.requestApprovalHandler = handler;
  }

  async prompt(input: string): Promise<ConversationMessage[]> {
    const result = await this.runTask(input);
    return result.messages;
  }

  async runTask(input: string): Promise<TaskResult> {
    await this.initialize();
    const runContext = this.createTaskRunContext(input);

    try {
      await this.beginTaskRun(runContext);

      let task = createTaskState({
        goal: input,
        model: runContext.model,
        existingMessages: this.state.messages,
        maxTurns: this.maxTurns
      });
      task = this.applyVerificationOverride(task);
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

        const update = updateTaskAfterTurn({ task, turnMessages: newMessages });
        task = update.task;
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

      const result = this.createTaskResult(task, runContext.taskMessages, loopDetected);
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
    await this.initialize();
    return this.registry.list();
  }

  async listProfiles(): Promise<string[]> {
    await this.initialize();
    return this.registry.listProfileNames();
  }

  async setModel(selection: string): Promise<UnifiedModel> {
    await this.initialize();
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
    await this.initialize();
    this.assertIdle("switch profile");
    this.profileSelection = profile;
    const resolved = await this.registry.resolveConfig(this.modelSelection, profile, this.baseURLOverride);
    this.state.profileName = resolved.profileName;
    this.state.model = resolved.model;
    this.state.config = resolved;
    this.state.memoryStore = new FolderMemoryStore(resolveMemoryStorePath(this.cwd, resolved.memory.storePath));
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

  async switchSession(sessionId: string, branchHeadId?: string): Promise<ConversationMessage[]> {
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
    if (metadata) {
      this.state.model = this.registry.resolve(`${metadata.provider}/${metadata.model}`);
    }
    const messages = await session.loadMessages(branchHeadId);
    this.state.session = session;
    this.state.messages = messages;
    this.state.currentTask = await this.loadCurrentTaskForHead(session, branchHeadId);
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
    this.state.messages = messages;
    this.state.currentTask = await this.loadCurrentTaskForHead(this.state.session, branchHeadId);
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

  getProfileName(): string {
    return this.state.profileName;
  }

  getCurrentTask(): TaskState | undefined {
    return this.state.currentTask;
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

  getSessionId(): string {
    return this.state.session.sessionId;
  }

  getBranchHeadId(): string | undefined {
    return this.state.session.getHeadId();
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

  private async renderMemoryContext(plan: MemoryRecallPlan): Promise<string> {
    const records = await this.state.memoryStore.getByIds(plan.selectedIds);
    return renderMemoryContext(records, new Set(plan.compactedIds));
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
      userRequest:
        typeof options.userMessage.content === "string"
          ? options.userMessage.content
          : options.userMessage.content.map((part) => ("text" in part ? part.text : `[image:${part.mimeType}]`)).join("\n"),
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

  private createTaskRunContext(input: string): TaskRunContext {
    const run = this.startRun();
    return {
      runId: run.id,
      controller: run.controller,
      session: this.state.session,
      model: this.state.model,
      userMessage: {
        role: "user",
        content: input,
        timestamp: Date.now()
      },
      taskMessages: [],
      recallAccumulator: createRecallAccumulator()
    };
  }

  private async beginTaskRun(context: TaskRunContext): Promise<void> {
    this.state.messages.push(context.userMessage);
    await context.session.appendMessage(context.userMessage);
    this.emitIfCurrent(context.runId, { type: "run-start", input: context.userMessage });
    this.emitIfCurrent(context.runId, { type: "message", message: context.userMessage });
  }

  private applyVerificationOverride(task: TaskState): TaskState {
    return this.verificationMode ? applyVerificationMode(task, this.verificationMode) : task;
  }

  private async startTaskLifecycle(runId: number, session: SessionManager, task: TaskState): Promise<void> {
    await this.publishTaskStart(runId, session, task);
    await this.transitionTaskPhase(runId, session, task, "execute");
  }

  private async publishTaskStart(runId: number, session: SessionManager, task: TaskState): Promise<void> {
    const plannedTask = advanceTaskPhase(task, "plan");
    this.state.currentTask = plannedTask;
    await session.appendTaskState(plannedTask);
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
    await session.appendTaskState(nextTask);
    this.emitIfCurrent(runId, { type: "task-phase-change", task: nextTask });
    this.emitIfCurrent(runId, { type: "task-update", task: nextTask });
    return nextTask;
  }

  private async blockTask(runId: number, session: SessionManager, task: TaskState): Promise<void> {
    const blockedTask = advanceTaskPhase(task, "blocked");
    this.state.currentTask = blockedTask;
    await session.appendTaskState(blockedTask);
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
    const tools = this.createToolsForRun(context);
    const turnPlan = buildTaskTurnPlan(task);

    if (turnPlan.phase === "verify") {
      this.emitIfCurrent(context.runId, { type: "task-verify-start", task });
    }
    this.emitIfCurrent(context.runId, { type: "assistant-start" });

    const newMessages = await runConversation({
      model: context.model,
      systemPrompt: createDefaultSystemPrompt(this.cwd, memoryContext, `${buildTaskContext(task)}\n${turnPlan.prompt}`),
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
    if (!this.state.config.memory.enabled || !this.state.config.memory.autoInject) {
      return "";
    }

    const recallPlan = await this.recallMemory();
    if (recallPlan.selectedIds.length === 0) {
      return "";
    }

    mergeRecallPlan(context.recallAccumulator, recallPlan);
    await context.session.appendMemoryReference(recallPlan, "auto");
    this.emitIfCurrent(context.runId, { type: "memory-recalled", plan: recallPlan, reason: "auto" });
    return this.renderMemoryContext(recallPlan);
  }

  private createToolsForRun(context: TaskRunContext) {
    return createProtectedCodingTools(this.cwd, {
      sessionId: context.session.sessionId,
      requestApproval: (request) => this.requestApproval(request),
      emit: (event) => this.emitIfCurrent(context.runId, event),
      policy: new DefaultPermissionPolicy()
    });
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

  private createTaskResult(task: TaskState, messages: ConversationMessage[], loopDetected: boolean): TaskResult {
    const status = loopDetected
      ? "blocked"
      : task.verification.mode === "none" || task.verification.passed
        ? "done"
        : task.attempts >= this.maxTurns
          ? "incomplete"
          : "done";

    return {
      status,
      summary: buildTaskSummary(task, messages, status),
      turns: task.attempts,
      verification: task.verification,
      messages
    };
  }

  private async persistTaskMemory(context: TaskRunContext): Promise<void> {
    if (!this.state.config.memory.enabled) {
      return;
    }

    if (context.taskMessages.length === 0) {
      return;
    }

    const memoryRecord = await this.compactAndPersistTurn({
      userMessage: context.userMessage,
      messages: context.taskMessages,
      recallPlan: collapseRecallAccumulator(context.recallAccumulator)
    });
    if (!memoryRecord) {
      return;
    }

    await context.session.appendMemoryRecord(memoryRecord);
    this.emitIfCurrent(context.runId, { type: "memory-persisted", record: memoryRecord });
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
    this.state.currentTask = finalTask;
    await session.appendTaskState(finalTask);
    await session.appendTaskSummary(result);
    this.emitIfCurrent(runId, { type: "task-update", task: finalTask });
    return finalTask;
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
      if (entry && reachable.has(entry.id) && entry.entryType === "task_state") {
        return entry.payload as TaskState;
      }
    }

    return undefined;
  }
}
