export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface TextPart {
  type: "text";
  text: string;
}

export interface ThinkingPart {
  type: "thinking";
  thinking: string;
}

export interface ImagePart {
  type: "image";
  mimeType: string;
  data: string;
}

export type UserInputOrigin = "local_cli" | "local_tui" | "remote_platform";

export interface InputImageAttachment {
  kind: "image";
  mimeType: string;
  data: string;
  sourceLabel?: string;
  origin?: UserInputOrigin;
}

export interface TaskInput {
  text?: string;
  attachments?: InputImageAttachment[];
}

export interface ToolCallPart {
  type: "tool-call";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type AssistantPart = TextPart | ThinkingPart | ToolCallPart;
export type ToolResultPart = TextPart | ImagePart;
export type UserPart = TextPart | ImagePart;

export interface UserMessage {
  role: "user";
  content: string | UserPart[];
  timestamp: number;
}

export interface AssistantMessage {
  role: "assistant";
  content: AssistantPart[];
  provider: string;
  model: string;
  stopReason: "stop" | "tool_use" | "length" | "error";
  timestamp: number;
}

export interface ToolResultMessage {
  role: "tool";
  toolCallId: string;
  toolName: string;
  input?: unknown;
  inputSignature?: string;
  content: string | ToolResultPart[];
  isError: boolean;
  timestamp: number;
}

export type ConversationMessage = UserMessage | AssistantMessage | ToolResultMessage;

export interface UnifiedToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type ModelTransport = "openai-compatible" | "anthropic" | "gemini";

export interface UnifiedModel {
  provider: string;
  modelId: string;
  family: "openai-compatible" | "anthropic" | "gemini";
  transport?: ModelTransport;
  runtimeProviderKey?: string;
  baseURL: string;
  apiKey?: string;
  apiKeyEnv?: string;
  providerFactory?: "openai" | "anthropic" | "openrouter" | "google" | "custom";
  supportsTools: boolean;
  supportsReasoning: boolean;
  supportsAttachments?: boolean;
  contextWindow?: number;
}

export interface MonoProfileConfig {
  provider: string;
  modelId: string;
  baseURL: string;
  family: "openai-compatible" | "anthropic" | "gemini";
  transport: ModelTransport;
  runtimeProviderKey?: string;
  providerFactory?: "openai" | "anthropic" | "openrouter" | "google" | "custom";
  apiKeyRef?: string;
  apiKeyEnv?: string;
  supportsTools: boolean;
  supportsReasoning: boolean;
  supportsAttachments?: boolean;
  contextWindow?: number;
}

export interface MonoProjectConfig {
  profile?: string;
  provider?: string;
  modelId?: string;
  baseURL?: string;
  apiKeyRef?: string;
  apiKeyEnv?: string;
  memory?: Partial<MonoMemoryConfig>;
  context?: Partial<MonoContextConfig>;
}

export type MonoTelegramDmPolicy = "pairing" | "allowlist" | "open" | "disabled";

export interface MonoTelegramGroupConfig {
  allow?: boolean;
  requireMention?: boolean;
  allowFrom?: string[];
}

export interface MonoTelegramConfig {
  enabled: boolean;
  botToken?: string;
  botId?: string;
  allowFrom: string[];
  groupAllowFrom: string[];
  groups: Record<string, MonoTelegramGroupConfig>;
  dmPolicy: MonoTelegramDmPolicy;
  pollingTimeoutSeconds: number;
}

export interface MonoChannelsConfig {
  telegram: MonoTelegramConfig;
}

export interface MonoMemoryConfig {
  enabled: boolean;
  autoInject: boolean;
  storePath: string;
  latestRoots: number;
  compactedLevelNum: number;
  rawPairLevelNum: number;
  compactedCapNum: number;
  rawPairCapNum: number;
  keywordSearchLimit: number;
  retrievalBackend: "local" | "openviking" | "seekdb";
  fallbackToLocalOnFailure: boolean;
  openViking: MonoOpenVikingConfig;
  seekDb: MonoSeekDbConfig;
  v2: MonoMemoryV2Config;
}

export interface MonoOpenVikingConfig {
  enabled: boolean;
  url?: string;
  apiKeyEnv?: string;
  agentId?: string;
  timeoutMs: number;
  targetUri: string;
  useSessionSearch: boolean;
  shadowExport: boolean;
}

export interface MonoSeekDbConfig {
  enabled: boolean;
  mode: "mysql" | "python-embedded";
  timeoutMs: number;
  mysqlBinary: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  passwordEnv?: string;
  pythonExecutable?: string;
  pythonModule?: string;
  embeddedPath?: string;
  mirrorSessionsOnly: boolean;
}

export interface MonoMemoryV2DecayConfig {
  explicitPreferenceDays: number;
  inferredTraitDays: number;
  relationshipSignalDays: number;
}

export interface MonoMemoryV2PromotionConfig {
  minPatternOccurrences: number;
  stablePreferenceOccurrences: number;
  stableInferenceDays: number;
}

export interface MonoMemoryV2Config {
  enabled: boolean;
  storePath: string;
  primaryEntityId: string;
  injectIntoContext: boolean;
  enableInference: boolean;
  maxEvidencePerPackage: number;
  openVikingSync: "off" | "async";
  decay: MonoMemoryV2DecayConfig;
  promotion: MonoMemoryV2PromotionConfig;
}

export type StructuredMemoryScope = "self" | "other" | "project" | "episodic" | "external";
export type MemoryEvidenceType =
  | "explicit_preference"
  | "implicit_preference"
  | "interaction_pattern"
  | "relationship_signal"
  | "self_reflection"
  | "project_fact";
export type InferenceDecayPolicy = "slow" | "medium" | "fast";
export type InferenceStatus = "hypothesis" | "reviewed" | "stable";

export interface MemoryEvidenceRecord {
  id: string;
  entityId: string;
  createdAt: number;
  type: MemoryEvidenceType;
  content: string;
  summary: string;
  weight: number;
  sessionId?: string;
  eventId?: string;
  tags: string[];
}

export interface SelfIdentityRecord {
  updatedAt: number;
  mission?: string;
  nonNegotiablePrinciples: string[];
  defaultSocialStance?: string;
  defaultReasoningStance?: string;
  boundaries: string[];
  forbiddenIdentityClaims: string[];
  styleContract: string[];
  summary?: string;
}

export interface SelfValueRecord {
  name: string;
  priority: number;
  description?: string;
  behavioralRules: string[];
}

export interface SelfTraitRecord {
  name: string;
  baseline: number;
  varianceByContext: Record<string, number>;
  evidenceCount: number;
  lastReviewed: number;
}

export interface SelfRoleRecord {
  role: string;
  triggers: string[];
  obligations: string[];
  styleShift: Record<string, string | number | boolean>;
}

export interface SelfGuideConflictRule {
  when: string;
  prefer: string;
  unless?: string;
}

export interface SelfGuidesRecord {
  updatedAt: number;
  actualSelf: {
    strengths: string[];
    limitations: string[];
  };
  idealSelf: {
    aspirations: string[];
  };
  oughtSelf: {
    duties: string[];
  };
  conflictRules: SelfGuideConflictRule[];
}

export interface NarrativeUpdateRecord {
  id: string;
  createdAt: number;
  eventId?: string;
  interpretation: string;
  carryForwardImplication: string;
  confidenceDelta?: number;
}

export interface OtherEntityProfileRecord {
  entityId: string;
  updatedAt: number;
  knownFacts: Record<string, string>;
  communicationNotes: string[];
}

export interface OtherPreferenceRecord {
  key: string;
  summary: string;
  polarity: "prefer" | "avoid";
  confidence: number;
  evidenceIds: string[];
  updatedAt: number;
}

export interface OtherPreferencesRecord {
  entityId: string;
  updatedAt: number;
  items: OtherPreferenceRecord[];
}

export interface OtherInferenceRecord {
  id: string;
  trait: string;
  summary: string;
  confidence: number;
  basedOn: string[];
  decayPolicy: InferenceDecayPolicy;
  status: InferenceStatus;
  updatedAt: number;
}

export interface OtherRelationshipStateRecord {
  entityId: string;
  updatedAt: number;
  trustLevel: number;
  collaborationMode: string;
  recentTensions: string[];
}

export interface ProjectMemoryProfileRecord {
  updatedAt: number;
  workspaceSummary: string;
  durableFacts: string[];
  collaborationNorms: string[];
}

export interface EpisodicEventRecord {
  id: string;
  createdAt: number;
  entityId: string;
  sessionId?: string;
  branchHeadId?: string;
  queryText: string;
  summary: string;
  messages: string[];
  salience: number;
  extractedPreferenceKeys: string[];
}

export interface StructuredMemoryPackageEntry {
  scope: StructuredMemoryScope;
  title: string;
  summary: string;
  confidence?: number;
  evidenceIds?: string[];
  sourceIds?: string[];
}

export interface StructuredMemoryPackage {
  activeEntityId: string;
  generatedAt: number;
  entries: StructuredMemoryPackageEntry[];
  evidence: MemoryEvidenceRecord[];
  externalItems: Array<{
    id: string;
    title: string;
    text: string;
    score?: number;
  }>;
}

export type ContextTruncationWarningMode = "off" | "once" | "always";

export interface MonoContextIdentityConfig {
  injectOperator: boolean;
  injectProjectIdentity: boolean;
}

export interface MonoContextBootstrapConfig {
  enabled: boolean;
  files: string[];
  maxCharsPerFile: number;
  totalMaxChars: number;
  truncationWarning: ContextTruncationWarningMode;
}

export interface MonoContextDocsConfig {
  enabled: boolean;
  entryPaths: string[];
}

export interface MonoContextMemoryConfig {
  injectBootstrapMemoryFile: boolean;
  injectRetrievedMemory: boolean;
}

export interface MonoContextReportingConfig {
  enabled: boolean;
}

export interface MonoContextConfig {
  enabled: boolean;
  userTimezone: string;
  identity: MonoContextIdentityConfig;
  bootstrap: MonoContextBootstrapConfig;
  docs: MonoContextDocsConfig;
  memory: MonoContextMemoryConfig;
  reporting: MonoContextReportingConfig;
}

export type VerificationMode = "none" | "light" | "strict";

export interface TaskItem {
  id: string;
  description: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
}

export type TaskPhase = "plan" | "execute" | "verify" | "summarize" | "done" | "blocked" | "incomplete" | "aborted";

export interface VerificationState {
  mode: VerificationMode;
  passed?: boolean;
  reason?: string;
  evidence: string[];
  lastCheckedAt?: number;
}

export interface TaskState {
  taskId: string;
  goal: string;
  phase: TaskPhase;
  attempts: number;
  verification: VerificationState;
  currentTodoMemoryId?: string;
}

export interface TaskTodoRecord {
  id: string;
  taskId: string;
  sessionId: string;
  branchHeadId?: string;
  projectKey: string;
  createdAt: number;
  updatedAt: number;
  goal: string;
  todos: TaskItem[];
  status: "active" | "completed" | "cancelled" | "blocked";
  verificationMode: VerificationMode;
  summary?: string;
}

export interface SessionCompressionResult {
  summary: string;
  preservedRecentMessages: number;
  replacedMessageCount: number;
  tokenEstimateBefore: number;
  tokenEstimateAfter: number;
}

export interface TaskResult {
  taskId?: string;
  todoMemoryId?: string;
  status: "done" | "blocked" | "aborted" | "incomplete";
  summary: string;
  turns: number;
  verification?: VerificationState;
  messages: ConversationMessage[];
}

export interface MonoGlobalConfig {
  version: number;
  mono: {
    defaultProfile: string;
    profiles: Record<string, MonoProfileConfig>;
    settings?: {
      approvalMode?: "default" | "always-ask" | "auto-approve-safe";
      theme?: string;
    };
    memory?: Partial<MonoMemoryConfig>;
    context?: Partial<MonoContextConfig>;
    channels?: Partial<MonoChannelsConfig>;
  };
  projects?: Record<string, MonoProjectConfig>;
}

export interface MonoSecretsConfig {
  version: number;
  profiles: Record<string, { apiKey: string }>;
}

export interface ResolvedMonoConfig {
  profileName: string;
  model: UnifiedModel;
  memory: MonoMemoryConfig;
  context: MonoContextConfig;
  channels: MonoChannelsConfig;
  apiKey?: string;
  source: {
    profile:
      | "cli"
      | "env"
      | "project-mono"
      | "global-mono"
      | "legacy-project-agents"
      | "legacy-global-agents"
      | "legacy-project-mono-models"
      | "legacy-global-mono-models"
      | "builtin";
    apiKey: "cli" | "env" | "local-secrets" | "provider-env" | "config-inline" | "none";
  };
}

export interface MonoConfigSummary {
  configDir: string;
  globalConfigPath: string;
  projectConfigPath: string;
  sessionsDir: string;
  memoryDir: string;
  defaultProfile?: string;
  resolvedProfile?: string;
  hasAnyProfiles: boolean;
}

export type ContextSectionKind =
  | "operator_identity"
  | "project_identity"
  | "runtime"
  | "task"
  | "memory"
  | "skills"
  | "docs"
  | "project";

export interface ContextSectionReport {
  kind: ContextSectionKind;
  title: string;
  chars: number;
  estimatedTokens: number;
}

export type BootstrapFileStatus = "included" | "truncated" | "missing" | "skipped" | "disabled";

export interface BootstrapFileReport {
  path: string;
  rawChars: number;
  injectedChars: number;
  status: BootstrapFileStatus;
}

export interface ContextMemoryReport {
  enabled: boolean;
  autoInject: boolean;
  backend: MonoMemoryConfig["retrievalBackend"];
  retrievedChars: number;
  retrievedMemoryIds: string[];
  bootstrapMemoryPath?: string;
  bootstrapMemoryIncluded: boolean;
}

export interface ContextAssemblyReport {
  generatedAt: number;
  cwd: string;
  totalChars: number;
  estimatedTokens: number;
  sections: ContextSectionReport[];
  bootstrapFiles: BootstrapFileReport[];
  memory: ContextMemoryReport;
}

export interface ToolExecutionUpdate<TDetails = unknown> {
  content: string | ToolResultPart[];
  details?: TDetails;
}

export interface ToolExecutionResult<TDetails = unknown> {
  content: string | ToolResultPart[];
  details?: TDetails;
}

export interface ToolCallContext {
  toolCallId: string;
  signal?: AbortSignal;
  onUpdate?: (update: ToolExecutionUpdate) => void;
}

export type ToolExecutionMode = "serial" | "parallel_readonly";

export interface AgentTool<TArgs = unknown, TDetails = unknown> extends UnifiedToolSpec {
  needsConfirmation?: boolean;
  executionMode?: ToolExecutionMode;
  conflictKey?(args: TArgs): string | null;
  execute(args: TArgs, context: ToolCallContext): Promise<ToolExecutionResult<TDetails>>;
  parseArgs?(args: unknown): TArgs;
}

export interface PermissionRequest {
  toolName: string;
  input: unknown;
  cwd: string;
  sessionId: string;
}

export type PermissionDecision =
  | { type: "allow" }
  | { type: "deny"; reason: string }
  | { type: "ask"; reason: string };

export interface PermissionPolicy {
  evaluate(request: PermissionRequest): PermissionDecision;
}

export interface ApprovalRequest extends PermissionRequest {
  reason: string;
}

export interface SessionPointer {
  sessionId: string;
  branchHeadId?: string;
  filePath: string;
}

export interface SessionSummary {
  sessionId: string;
  filePath: string;
  updatedAt: number;
  cwd: string;
}

export interface SessionNodeSummary {
  id: string;
  parentId?: string;
  entryType: SessionEntryType;
  timestamp: number;
  label: string;
}

export interface MemoryDetailedTraceUser {
  type: "user";
  text: string;
}

export interface MemoryDetailedTraceAssistant {
  type: "assistant";
  text?: string;
  thinking?: string;
}

export interface MemoryDetailedTraceToolCall {
  type: "tool_call";
  toolName: string;
  args: unknown;
  toolCallId?: string;
}

export interface MemoryDetailedTraceToolResult {
  type: "tool_result";
  toolName: string;
  output: string;
  truncated?: boolean;
}

export type MemoryDetailedTrace =
  | MemoryDetailedTraceUser
  | MemoryDetailedTraceAssistant
  | MemoryDetailedTraceToolCall
  | MemoryDetailedTraceToolResult;

export interface MemoryRecord {
  id: string;
  createdAt: number;
  projectKey: string;
  sessionId?: string;
  branchHeadId?: string;
  parents: string[];
  children: string[];
  referencedMemoryIds: string[];
  input: string;
  compacted: string[];
  output: string;
  detailed: MemoryDetailedTrace[];
  tags: string[];
  files: string[];
  tools: string[];
}

export interface MemorySearchMatch {
  id: string;
  matchedLines: Array<{ line: number; text: string }>;
}

export interface MemoryRecallPlan {
  rootIds: string[];
  compactedIds: string[];
  rawPairIds: string[];
  selectedIds: string[];
}

export type SessionEntryType =
  | "metadata"
  | "user"
  | "assistant"
  | "tool"
  | "branch"
  | "label"
  | "compaction"
  | "task_state"
  | "task_pointer"
  | "task_summary"
  | "session_compression"
  | "memory_reference"
  | "memory_record";

export interface SessionEntryBase<TType extends SessionEntryType, TPayload> {
  id: string;
  parentId?: string;
  timestamp: number;
  entryType: TType;
  payload: TPayload;
}

export type MetadataEntry = SessionEntryBase<"metadata", { cwd: string; model: string; provider: string }>;
export type UserEntry = SessionEntryBase<"user", UserMessage>;
export type AssistantEntry = SessionEntryBase<"assistant", AssistantMessage>;
export type ToolEntry = SessionEntryBase<"tool", ToolResultMessage>;
export type BranchEntry = SessionEntryBase<"branch", { name?: string }>;
export type LabelEntry = SessionEntryBase<"label", { label: string }>;
export type CompactionEntry = SessionEntryBase<"compaction", { summary: string }>;
export type TaskStateEntry = SessionEntryBase<"task_state", TaskState>;
export type TaskPointerEntry = SessionEntryBase<
  "task_pointer",
  {
    taskId: string;
    todoMemoryId?: string;
    goal: string;
    phase: TaskPhase;
    attempts: number;
    verification: VerificationState;
  }
>;
export type TaskSummaryEntry = SessionEntryBase<
  "task_summary",
  {
    taskId: string;
    todoMemoryId?: string;
    status: TaskResult["status"];
    summary: string;
    verification?: VerificationState;
  }
>;
export type SessionCompressionEntry = SessionEntryBase<"session_compression", SessionCompressionResult>;
export type MemoryReferenceEntry = SessionEntryBase<
  "memory_reference",
  {
    memoryIds: string[];
    compactedIds: string[];
    rawPairIds: string[];
    reason: "auto" | "manual";
    query?: string;
  }
>;
export type MemoryRecordEntry = SessionEntryBase<"memory_record", { memoryId: string }>;

export type SessionEntry =
  | MetadataEntry
  | UserEntry
  | AssistantEntry
  | ToolEntry
  | BranchEntry
  | LabelEntry
  | CompactionEntry
  | TaskStateEntry
  | TaskPointerEntry
  | TaskSummaryEntry
  | SessionCompressionEntry
  | MemoryReferenceEntry
  | MemoryRecordEntry;

export type RuntimeEvent =
  | { type: "run-start"; input: UserMessage }
  | { type: "task-start"; task: TaskState }
  | { type: "task-update"; task: TaskState }
  | { type: "task-phase-change"; task: TaskState }
  | { type: "task-verify-start"; task: TaskState }
  | { type: "task-verify-result"; task: TaskState; passed: boolean; reason: string }
  | { type: "task-todos-updated"; record: TaskTodoRecord }
  | { type: "task-todos-cleared"; taskId: string }
  | { type: "task-summary"; result: TaskResult }
  | { type: "session-compressed"; result: SessionCompressionResult }
  | { type: "loop-detected"; reason: string; task: TaskState }
  | { type: "memory-recalled"; plan: MemoryRecallPlan; reason: "auto" | "manual"; query?: string }
  | { type: "assistant-start" }
  | { type: "assistant-text-delta"; delta: string }
  | { type: "assistant-thinking-delta"; delta: string }
  | { type: "assistant-tool-call"; toolCallId: string; toolName: string; argsText?: string }
  | { type: "tool-start"; toolCallId: string; toolName: string; input: unknown }
  | { type: "tool-update"; toolCallId: string; toolName: string; update: ToolExecutionUpdate }
  | { type: "tool-end"; toolCallId: string; toolName: string; result: ToolExecutionResult; isError: boolean }
  | { type: "approval-request"; request: ApprovalRequest }
  | { type: "approval-result"; toolName: string; approved: boolean; reason?: string }
  | { type: "message"; message: ConversationMessage }
  | { type: "memory-persisted"; record: MemoryRecord }
  | { type: "run-aborted"; reason: "user" | "superseded" }
  | { type: "run-end"; messages: ConversationMessage[] }
  | { type: "error"; error: Error };

export interface RunPromptOptions {
  maxSteps?: number;
}
