export type ModelTransport = "openai-compatible" | "openai-responses" | "anthropic" | "gemini"
export type ApprovalMode = "default" | "always-ask" | "auto-approve-safe"
export type ApprovalPolicy = "on-request" | "never" | "auto-approve"
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access"
export type SensitiveActionMode = "allow_all" | "blacklist" | "strict"
export type ThemeName = "light" | "dark" | "system" | string
export type AlternateBufferMode = boolean | "auto"

export interface UnifiedModel {
  provider: string
  modelId: string
  family: "openai-compatible" | "anthropic" | "gemini"
  transport?: ModelTransport
  runtimeProviderKey?: string
  baseURL: string
  apiKeyEnv?: string
  providerFactory?: "openai" | "anthropic" | "openrouter" | "google" | "custom"
  supportsTools: boolean
  supportsReasoning: boolean
  supportsAttachments?: boolean
  contextWindow?: number
}

export interface ProfileConfig {
  provider: string
  modelId: string
  baseURL: string
  family: "openai-compatible" | "anthropic" | "gemini"
  transport: ModelTransport
  runtimeProviderKey?: string
  providerFactory?: "openai" | "anthropic" | "openrouter" | "google" | "custom"
  apiKeyRef?: string
  apiKeyEnv?: string
  supportsTools: boolean
  supportsReasoning: boolean
  supportsAttachments?: boolean
  contextWindow?: number
  [key: string]: unknown
}

export interface SafetySettingsConfig {
  approvalMode: ApprovalMode
  approvalPolicy: ApprovalPolicy
  sandboxMode: SandboxMode
  sensitiveActionMode: SensitiveActionMode
  [key: string]: unknown
}

export interface AutonomySettingsConfig {
  enabled: boolean
  heartbeatIntervalMs: number
  maxAutonomousTasksPerHour: number
  allowBroadExecution: boolean
  isolatedSession: boolean
  [key: string]: unknown
}

export interface AppearanceSettingsConfig {
  theme: ThemeName
  [key: string]: unknown
}

export interface TuiSettingsConfig {
  cleanUiDetailsVisible: boolean
  footerVisible: boolean
  alternateBuffer: AlternateBufferMode
  shortcutsHint: boolean
  assistantMarkdownEnabled: boolean
  thinkingVisible: boolean
  toolDetailsVisible: boolean
  [key: string]: unknown
}

export interface SettingsConfig {
  approvalMode: ApprovalMode
  approvalPolicy: ApprovalPolicy
  sandboxMode: SandboxMode
  theme: ThemeName
  sensitiveActionMode: SensitiveActionMode
  maxAutonomousTasksPerHour: number
  safety: SafetySettingsConfig
  autonomy: AutonomySettingsConfig
  appearance: AppearanceSettingsConfig
  tui: TuiSettingsConfig
  [key: string]: unknown
}

export interface OpenVikingConfig {
  enabled: boolean
  url?: string
  apiKeyEnv?: string
  agentId?: string
  timeoutMs: number
  targetUri: string
  useSessionSearch: boolean
  shadowExport: boolean
  [key: string]: unknown
}

export interface SeekDbConfig {
  enabled: boolean
  mode: "mysql" | "python-embedded"
  timeoutMs: number
  mysqlBinary: string
  host?: string
  port?: number
  database?: string
  user?: string
  passwordEnv?: string
  pythonExecutable?: string
  pythonModule?: string
  embeddedPath?: string
  mirrorSessionsOnly: boolean
  [key: string]: unknown
}

export interface MemoryV2Config {
  enabled: boolean
  storePath: string
  primaryEntityId: string
  injectIntoContext: boolean
  enableInference: boolean
  maxEvidencePerPackage: number
  openVikingSync: "off" | "async"
  decay: {
    explicitPreferenceDays: number
    inferredTraitDays: number
    relationshipSignalDays: number
    [key: string]: unknown
  }
  promotion: {
    minPatternOccurrences: number
    stablePreferenceOccurrences: number
    stableInferenceDays: number
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface MemoryConfig {
  enabled: boolean
  autoInject: boolean
  storePath: string
  latestRoots: number
  compactedLevelNum: number
  rawPairLevelNum: number
  compactedCapNum: number
  rawPairCapNum: number
  keywordSearchLimit: number
  retrievalBackend: "local" | "openviking" | "seekdb"
  fallbackToLocalOnFailure: boolean
  openViking: OpenVikingConfig
  seekDb: SeekDbConfig
  v2: MemoryV2Config
  [key: string]: unknown
}

export interface ContextConfig {
  enabled: boolean
  userTimezone: string
  identity: {
    injectOperator: boolean
    injectProjectIdentity: boolean
    [key: string]: unknown
  }
  bootstrap: {
    enabled: boolean
    files: string[]
    maxCharsPerFile: number
    totalMaxChars: number
    truncationWarning: "off" | "once" | "always"
    [key: string]: unknown
  }
  docs: {
    enabled: boolean
    entryPaths: string[]
    [key: string]: unknown
  }
  memory: {
    injectBootstrapMemoryFile: boolean
    injectRetrievedMemory: boolean
    [key: string]: unknown
  }
  reporting: {
    enabled: boolean
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface TelegramConfig {
  enabled: boolean
  botToken?: string
  botId?: string
  allowFrom: string[]
  groupAllowFrom: string[]
  groups: Record<string, { allow?: boolean; requireMention?: boolean; allowFrom?: string[] }>
  actions: {
    send: boolean
    sticker: boolean
    photo: boolean
    document: boolean
    edit: boolean
    delete: boolean
    react: boolean
    [key: string]: unknown
  }
  approval: {
    allowChats: string[]
    commandDenylist: string[]
    [key: string]: unknown
  }
  reply: {
    multiMessage: boolean
    splitDelayMs: number
    stickers: {
      enabled: boolean
      storePath: string
      [key: string]: unknown
    }
    [key: string]: unknown
  }
  dmPolicy: "pairing" | "allowlist" | "open" | "disabled"
  pollingTimeoutSeconds: number
  [key: string]: unknown
}

export interface ChannelsConfig {
  telegram: TelegramConfig
  [key: string]: unknown
}

export interface ProjectConfig {
  profile?: string
  provider?: string
  modelId?: string
  baseURL?: string
  apiKeyRef?: string
  apiKeyEnv?: string
  memory?: Partial<MemoryConfig>
  context?: Partial<ContextConfig>
  [key: string]: unknown
}

export interface GlobalConfig {
  version: number
  mono: {
    defaultProfile: string
    profiles: Record<string, ProfileConfig>
    settings: SettingsConfig
    memory: MemoryConfig
    context: ContextConfig
    channels: ChannelsConfig
    [key: string]: unknown
  }
  projects?: Record<string, ProjectConfig>
  [key: string]: unknown
}

export interface ConfigSnapshotResponse {
  config: GlobalConfig
  baseHash: string
  configPath: string
  redactedPaths: string[]
}

export interface BootstrapResponse {
  globalConfigPath: string
  globalSecretsPath: string
  projectConfigPath: string
  projectConfigExists: boolean
  summary: {
    configDir: string
    globalConfigPath: string
    projectConfigPath: string
    sessionsDir: string
    memoryDir: string
    defaultProfile?: string
    resolvedProfile?: string
    hasAnyProfiles: boolean
  }
  resolvedProfile: string
  profileSource: string
  apiKeySource: string
}

export interface ProfileSummary {
  name: string
  profile: ProfileConfig
  isDefault: boolean
  hasSecret: boolean
}

export interface ModelsResponse {
  models: UnifiedModel[]
  profiles: Array<{ name: string; model: UnifiedModel }>
}

export interface MemoryStatus {
  enabled: boolean
  autoInject: boolean
  retrievalBackend: string
  fallbackToLocal: boolean
  storePath: string
  v2Enabled: boolean
  v2StorePath: string
  v2PrimaryEntityId: string
  v2OpenVikingSync: string
  v2CurrentGoals: number
  v2CurrentTensions: number
  v2OpenQuestions: number
  v2FrictionPatterns: number
  v2PendingQueue: number
  v2AutonomyQueue: number
  v2FeedbackSignals: number
  v2HeartbeatDecisions: number
  v2HeartbeatReplies: number
  v2Conflicts: number
  openViking: string
  seekDb: string
  records: number
  currentSession: string
  lastMemory: string
}

export interface TelegramStatus {
  ok: boolean
  title: string
  lines: string[]
  status: string
  shouldReloadRuntime?: boolean
}

export interface SkillRecord {
  name: string
  description: string
  location: string
  content: string
  origin: "builtin" | "global" | "project"
}

export interface SkillSearchResult {
  id: string
  name: string
  source: string
  installs: number
  installSource: string
  url: string
}
