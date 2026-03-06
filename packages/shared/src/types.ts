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

export interface UnifiedModel {
  provider: string;
  modelId: string;
  family: "openai-compatible" | "anthropic" | "gemini";
  transport?: "xsai-openai-compatible";
  baseURL: string;
  apiKey?: string;
  apiKeyEnv?: string;
  providerFactory?: "openai" | "anthropic" | "openrouter" | "google" | "custom";
  supportsTools: boolean;
  supportsReasoning: boolean;
  contextWindow?: number;
}

export interface MonoProfileConfig {
  provider: string;
  modelId: string;
  baseURL: string;
  family: "openai-compatible" | "anthropic" | "gemini";
  transport: "xsai-openai-compatible";
  providerFactory?: "openai" | "anthropic" | "openrouter" | "google" | "custom";
  apiKeyRef?: string;
  apiKeyEnv?: string;
  supportsTools: boolean;
  supportsReasoning: boolean;
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
  todos: TaskItem[];
  attempts: number;
  verification: VerificationState;
}

export interface SessionCompressionResult {
  summary: string;
  preservedRecentMessages: number;
  replacedMessageCount: number;
  tokenEstimateBefore: number;
  tokenEstimateAfter: number;
}

export interface TaskResult {
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

export interface AgentTool<TArgs = unknown, TDetails = unknown> extends UnifiedToolSpec {
  needsConfirmation?: boolean;
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
export type TaskSummaryEntry = SessionEntryBase<
  "task_summary",
  {
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
