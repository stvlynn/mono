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

export type SessionEntryType =
  | "metadata"
  | "user"
  | "assistant"
  | "tool"
  | "branch"
  | "label"
  | "compaction";

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

export type SessionEntry =
  | MetadataEntry
  | UserEntry
  | AssistantEntry
  | ToolEntry
  | BranchEntry
  | LabelEntry
  | CompactionEntry;

export type RuntimeEvent =
  | { type: "run-start"; input: UserMessage }
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
  | { type: "run-aborted"; reason: "user" | "superseded" }
  | { type: "run-end"; messages: ConversationMessage[] }
  | { type: "error"; error: Error };

export interface RunPromptOptions {
  maxSteps?: number;
}
