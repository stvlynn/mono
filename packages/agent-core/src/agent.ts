import {
  type ApprovalRequest,
  type MonoConfigSummary,
  type ConversationMessage,
  type RuntimeEvent,
  type ResolvedMonoConfig,
  type SessionNodeSummary,
  type SessionSummary,
  type ThinkingLevel,
  type UnifiedModel,
  type UserMessage
} from "@mono/shared";
import { ModelRegistry, runConversation } from "@mono/llm";
import { SessionManager } from "@mono/session";
import { createProtectedCodingTools, DefaultPermissionPolicy } from "@mono/tools";
import { createDefaultSystemPrompt } from "./system-prompt.js";

export interface AgentOptions {
  cwd?: string;
  model?: string;
  profile?: string;
  baseURL?: string;
  thinkingLevel?: ThinkingLevel;
  maxSteps?: number;
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
}

export class Agent {
  private readonly cwd: string;
  private readonly registry: ModelRegistry;
  private readonly listeners = new Set<(event: RuntimeEvent) => void>();
  private readonly maxSteps: number;
  private readonly autoApprove: boolean;
  private requestApprovalHandler?: (request: ApprovalRequest) => Promise<boolean>;
  private initialized = false;
  private modelSelection?: string;
  private profileSelection?: string;
  private baseURLOverride?: string;
  private continueSession: boolean;
  private requestedThinkingLevel: ThinkingLevel;
  private activeRun?: { id: number; controller: AbortController };
  private nextRunId = 1;

  state!: AgentState;

  constructor(options: AgentOptions = {}) {
    this.cwd = options.cwd ?? process.cwd();
    this.registry = new ModelRegistry({ cwd: this.cwd });
    this.maxSteps = options.maxSteps ?? 8;
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
    this.state = {
      cwd: this.cwd,
      profileName: config.profileName,
      model,
      messages,
      thinkingLevel: this.requestedThinkingLevel,
      session,
      config,
      configSummary
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

  async prompt(input: string): Promise<ConversationMessage[]> {
    await this.initialize();
    const run = this.startRun();

    try {
      const userMessage: UserMessage = {
        role: "user",
        content: input,
        timestamp: Date.now()
      };

      const runSession = this.state.session;
      const runModel = this.state.model;
      this.state.messages.push(userMessage);
      await runSession.appendMessage(userMessage);
      this.emitIfCurrent(run.id, { type: "run-start", input: userMessage });
      this.emitIfCurrent(run.id, { type: "message", message: userMessage });
      this.emitIfCurrent(run.id, { type: "assistant-start" });

      const tools = createProtectedCodingTools(this.cwd, {
        sessionId: runSession.sessionId,
        requestApproval: (request) => this.requestApproval(request),
        emit: (event) => this.emitIfCurrent(run.id, event),
        policy: new DefaultPermissionPolicy()
      });

      const newMessages = await runConversation({
        model: runModel,
        systemPrompt: createDefaultSystemPrompt(this.cwd),
        messages: [...this.state.messages],
        tools,
        thinkingLevel: this.state.thinkingLevel,
        maxSteps: this.maxSteps,
        emit: (event) => this.emitIfCurrent(run.id, event),
        signal: run.controller.signal
      });

      if (!this.isRunCurrent(run.id)) {
        return [];
      }

      for (const message of newMessages) {
        if (!this.isRunCurrent(run.id)) {
          return [];
        }
        this.state.messages.push(message);
        await runSession.appendMessage(message);
        this.emitIfCurrent(run.id, { type: "message", message });
      }

      this.emitIfCurrent(run.id, { type: "run-end", messages: newMessages });
      return newMessages;
    } catch (error) {
      if (run.controller.signal.aborted || this.isAbortError(error)) {
        this.emitIfCurrent(run.id, { type: "run-aborted", reason: "user" });
        return [];
      }

      const resolvedError = error instanceof Error ? error : new Error(String(error));
      this.emitIfCurrent(run.id, { type: "error", error: resolvedError });
      throw resolvedError;
    } finally {
      this.finishRun(run.id);
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
    this.state.configSummary = await this.registry.getConfigSummary();
    return resolved;
  }

  async listSessions(): Promise<SessionSummary[]> {
    await this.initialize();
    return SessionManager.listSessions(this.cwd);
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

  getConfigSummary(): MonoConfigSummary {
    return this.state.configSummary;
  }

  getResolvedConfig(): ResolvedMonoConfig {
    return this.state.config;
  }

  getSessionId(): string {
    return this.state.session.sessionId;
  }

  getBranchHeadId(): string | undefined {
    return this.state.session.getHeadId();
  }
}
