import { access, readFile } from "node:fs/promises";
import { hostname, userInfo } from "node:os";
import { isAbsolute, relative, resolve as resolvePath } from "node:path";
import { defaultPromptRenderer, type PromptRenderer } from "@mono/prompts";
import type {
  BootstrapFileReport,
  BootstrapFileStatus,
  ContextAssemblyReport,
  ContextSectionKind,
  MemoryRecallPlan,
  ResolvedMonoConfig,
  ThinkingLevel,
  UnifiedModel,
  VerificationMode
} from "@mono/shared";
import { createDefaultSystemPrompt, type SystemPromptSection } from "./system-prompt.js";

export interface AssemblePromptContextInput {
  cwd: string;
  sessionId: string;
  sessionStartedAt: number;
  profileName: string;
  model: UnifiedModel;
  thinkingLevel: ThinkingLevel;
  verificationMode?: VerificationMode;
  autoApprove: boolean;
  config: ResolvedMonoConfig;
  taskContext?: string;
  memoryContext?: string;
  skillsContext?: string;
  memoryPlan?: MemoryRecallPlan;
  now?: number;
  renderer?: PromptRenderer;
}

export interface AssemblePromptContextResult {
  systemPrompt: string;
  report: ContextAssemblyReport;
  sections: SystemPromptSection[];
}

const PROJECT_IDENTITY_PATH = ".mono/IDENTITY.md";
const PROJECT_MEMORY_PATH = ".mono/MEMORY.md";

export async function assemblePromptContext(input: AssemblePromptContextInput): Promise<AssemblePromptContextResult> {
  const renderer = input.renderer ?? defaultPromptRenderer;
  const sections: SystemPromptSection[] = [];
  const sectionReports: ContextAssemblyReport["sections"] = [];
  const bootstrapFiles: BootstrapFileReport[] = [];
  const usedBootstrapPaths = new Set<string>();

  if (input.config.context.enabled && input.config.context.identity.injectOperator) {
    pushSection(sections, sectionReports, "operator_identity", "Operator Identity", buildOperatorIdentityBody(input));
  }

  if (input.config.context.enabled && input.config.context.identity.injectProjectIdentity) {
    const projectIdentity = await readOptionalContextFile({
      cwd: input.cwd,
      filePath: PROJECT_IDENTITY_PATH,
      maxChars: input.config.context.bootstrap.maxCharsPerFile
    });
    if (projectIdentity.content) {
      usedBootstrapPaths.add(PROJECT_IDENTITY_PATH);
      pushSection(sections, sectionReports, "project_identity", "Project Identity", projectIdentity.content);
    }
  }

  if (input.config.context.enabled) {
    pushSection(sections, sectionReports, "runtime", "Runtime Context", buildRuntimeBody(input));
  }

  if (input.taskContext?.trim()) {
    pushSection(sections, sectionReports, "task", "Task Context", input.taskContext.trim());
  }

  const memoryContext = input.config.context.memory.injectRetrievedMemory ? input.memoryContext?.trim() ?? "" : "";
  if (memoryContext) {
    pushSection(sections, sectionReports, "memory", "Memory Context", memoryContext);
  }

  if (input.skillsContext?.trim()) {
    pushSection(sections, sectionReports, "skills", "Skills Context", input.skillsContext.trim());
  }

  if (input.config.context.enabled && input.config.context.docs.enabled) {
    const docsBody = buildDocsBody(input.config.context.docs.entryPaths);
    if (docsBody) {
      pushSection(sections, sectionReports, "docs", "Docs Context", docsBody);
    }
  }

  if (input.config.context.enabled && input.config.context.bootstrap.enabled) {
    const projectContext = await buildProjectContext({
      cwd: input.cwd,
      files: input.config.context.bootstrap.files,
      maxCharsPerFile: input.config.context.bootstrap.maxCharsPerFile,
      totalMaxChars: input.config.context.bootstrap.totalMaxChars,
      truncationWarning: input.config.context.bootstrap.truncationWarning,
      includeMemoryFile: input.config.context.memory.injectBootstrapMemoryFile,
      usedPaths: usedBootstrapPaths
    });
    bootstrapFiles.push(...projectContext.bootstrapFiles);
    if (projectContext.body) {
      pushSection(sections, sectionReports, "project", "Project Context", projectContext.body);
    }
  }

  const systemPrompt = createDefaultSystemPrompt(
    {
      cwd: input.cwd,
      sections
    },
    renderer
  );

  return {
    systemPrompt,
    sections,
    report: {
      generatedAt: input.now ?? Date.now(),
      cwd: input.cwd,
      totalChars: systemPrompt.length,
      estimatedTokens: estimateTokens(systemPrompt),
      sections: sectionReports,
      bootstrapFiles,
      memory: {
        enabled: input.config.memory.enabled,
        autoInject: input.config.memory.autoInject,
        backend: input.config.memory.retrievalBackend,
        retrievedChars: memoryContext.length,
        retrievedMemoryIds: input.memoryPlan?.selectedIds ?? [],
        bootstrapMemoryPath: PROJECT_MEMORY_PATH,
        bootstrapMemoryIncluded: bootstrapFiles.some(
          (item) => item.path === PROJECT_MEMORY_PATH && (item.status === "included" || item.status === "truncated")
        )
      }
    }
  };
}

function pushSection(
  sections: SystemPromptSection[],
  reports: ContextAssemblyReport["sections"],
  kind: ContextSectionKind,
  title: string,
  body: string
): void {
  const normalizedBody = body.trim();
  if (!normalizedBody) {
    return;
  }
  sections.push({ title, body: normalizedBody });
  const rendered = renderSectionBlock(title, normalizedBody);
  reports.push({
    kind,
    title,
    chars: rendered.length,
    estimatedTokens: estimateTokens(rendered)
  });
}

function renderSectionBlock(title: string, body: string): string {
  return `## ${title}\n${body}`;
}

function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }
  return Math.ceil(text.length / 4);
}

function buildOperatorIdentityBody(input: AssemblePromptContextInput): string {
  const username = resolveUsername();
  const lines = [
    `User: ${username}`,
    `Host: ${hostname()}`,
    "Mode: local-cli",
    `Workspace: ${input.cwd}`
  ];
  return lines.join("\n");
}

function resolveUsername(): string {
  try {
    return userInfo().username;
  } catch {
    return process.env.USER ?? process.env.USERNAME ?? "unknown";
  }
}

function buildRuntimeBody(input: AssemblePromptContextInput): string {
  const timeZone = resolveTimeZone(input.config.context.userTimezone);
  const now = new Date(input.now ?? Date.now());
  const lines = [
    `Date: ${formatDateForTimeZone(now, timeZone)}`,
    `Timezone: ${timeZone}`,
    `Session: ${input.sessionId}`,
    `Session loaded at: ${new Date(input.sessionStartedAt).toISOString()}`,
    `Profile: ${input.profileName}`,
    `Model: ${input.model.provider}/${input.model.modelId}`,
    `Thinking level: ${input.thinkingLevel}`,
    `Verification mode: ${input.verificationMode ?? "light"}`,
    `Approval mode: ${input.autoApprove ? "auto-approve" : "interactive"}`,
    "If the exact current time matters, verify it with a tool before acting."
  ];
  return lines.join("\n");
}

function resolveTimeZone(configured: string): string {
  if (configured && configured !== "system") {
    return configured;
  }
  return Intl.DateTimeFormat().resolvedOptions().timeZone || process.env.TZ || "UTC";
}

function formatDateForTimeZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function buildDocsBody(entryPaths: string[]): string {
  const paths = entryPaths.map((value) => value.trim()).filter(Boolean);
  if (paths.length === 0) {
    return "";
  }
  return [
    "Use these local docs when you need repository behavior or architecture details:",
    ...paths.map((value) => `- ${value}`)
  ].join("\n");
}

async function buildProjectContext(input: {
  cwd: string;
  files: string[];
  maxCharsPerFile: number;
  totalMaxChars: number;
  truncationWarning: ResolvedMonoConfig["context"]["bootstrap"]["truncationWarning"];
  includeMemoryFile: boolean;
  usedPaths: Set<string>;
}): Promise<{ body: string; bootstrapFiles: BootstrapFileReport[] }> {
  const blocks: string[] = [];
  const reports: BootstrapFileReport[] = [];
  let remainingChars = input.totalMaxChars;
  let truncatedCount = 0;

  for (const configuredPath of input.files) {
    const normalizedPath = configuredPath.trim();
    if (!normalizedPath) {
      continue;
    }

    if (input.usedPaths.has(normalizedPath)) {
      reports.push(createBootstrapReport(normalizedPath, 0, 0, "skipped"));
      continue;
    }
    if (normalizedPath === PROJECT_MEMORY_PATH && !input.includeMemoryFile) {
      reports.push(createBootstrapReport(normalizedPath, 0, 0, "disabled"));
      continue;
    }

    const loaded = await readOptionalContextFile({
      cwd: input.cwd,
      filePath: normalizedPath,
      maxChars: Math.min(input.maxCharsPerFile, Math.max(remainingChars, 0))
    });
    if (!loaded.exists) {
      reports.push(createBootstrapReport(normalizedPath, 0, 0, "missing"));
      continue;
    }

    const rawChars = loaded.rawChars;
    if (remainingChars <= 0) {
      reports.push(createBootstrapReport(normalizedPath, rawChars, 0, "truncated"));
      truncatedCount += 1;
      continue;
    }

    const injectedText = loaded.content.slice(0, remainingChars);
    const injectedChars = injectedText.length;
    const status: BootstrapFileStatus = injectedChars < rawChars ? "truncated" : loaded.truncated ? "truncated" : "included";
    if (status === "truncated") {
      truncatedCount += 1;
    }
    remainingChars -= injectedChars;
    reports.push(createBootstrapReport(normalizedPath, rawChars, injectedChars, status));

    if (injectedText.trim()) {
      blocks.push(`<File path="${normalizedPath}">\n${injectedText.trim()}\n</File>`);
    }
  }

  if (blocks.length === 0) {
    return { body: "", bootstrapFiles: reports };
  }

  const warningLines = buildTruncationWarnings(input.truncationWarning, truncatedCount);
  return {
    body: [...warningLines, ...blocks].join("\n\n"),
    bootstrapFiles: reports
  };
}

function buildTruncationWarnings(
  mode: ResolvedMonoConfig["context"]["bootstrap"]["truncationWarning"],
  truncatedCount: number
): string[] {
  if (truncatedCount === 0 || mode === "off") {
    return [];
  }
  if (mode === "always") {
    return [`[ProjectContext warning] ${truncatedCount} bootstrap file(s) were truncated.`];
  }
  return ["[ProjectContext warning] Some bootstrap files were truncated to fit the prompt budget."];
}

function createBootstrapReport(
  path: string,
  rawChars: number,
  injectedChars: number,
  status: BootstrapFileStatus
): BootstrapFileReport {
  return {
    path,
    rawChars,
    injectedChars,
    status
  };
}

async function readOptionalContextFile(input: {
  cwd: string;
  filePath: string;
  maxChars: number;
}): Promise<{ exists: boolean; content: string; rawChars: number; truncated: boolean }> {
  const resolvedPath = resolveWorkspacePath(input.cwd, input.filePath);
  if (!resolvedPath) {
    return {
      exists: false,
      content: "",
      rawChars: 0,
      truncated: false
    };
  }

  try {
    await access(resolvedPath);
    const raw = await readFile(resolvedPath, "utf8");
    const rawChars = raw.length;
    const content = raw.slice(0, Math.max(input.maxChars, 0));
    return {
      exists: true,
      content,
      rawChars,
      truncated: content.length < rawChars
    };
  } catch {
    return {
      exists: false,
      content: "",
      rawChars: 0,
      truncated: false
    };
  }
}

function resolveWorkspacePath(cwd: string, filePath: string): string | undefined {
  const resolvedPath = isAbsolute(filePath) ? filePath : resolvePath(cwd, filePath);
  const relativePath = relative(cwd, resolvedPath);
  if (relativePath.startsWith("..")) {
    return undefined;
  }
  return resolvedPath;
}
