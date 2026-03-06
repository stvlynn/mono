import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  appendJsonLine,
  createId,
  type MemoryRecallPlan,
  now,
  readJsonLines,
  type ConversationMessage,
  type MemoryRecord,
  type SessionEntry,
  type SessionNodeSummary,
  type SessionEntryType,
  type SessionPointer,
  type SessionSummary,
  type SessionCompressionResult,
  type TaskResult,
  type TaskState,
  type UnifiedModel
} from "@mono/shared";
import { getMonoConfigPaths } from "@mono/config";
import { cwdSlug, getSessionsDir } from "./config.js";

export interface SessionManagerOptions {
  cwd: string;
  sessionId?: string;
  branchHeadId?: string;
  sessionsDir?: string;
}

export class SessionManager {
  readonly cwd: string;
  readonly sessionId: string;
  readonly filePath: string;
  private headId?: string;

  constructor(options: SessionManagerOptions) {
    this.cwd = options.cwd;
    this.sessionId = options.sessionId ?? createId();
    this.filePath = join(options.sessionsDir ?? getSessionsDir(this.cwd), cwdSlug(this.cwd), `${this.sessionId}.jsonl`);
    this.headId = options.branchHeadId;
  }

  pointer(): SessionPointer {
    return {
      sessionId: this.sessionId,
      branchHeadId: this.headId,
      filePath: this.filePath
    };
  }

  getHeadId(): string | undefined {
    return this.headId;
  }

  async initialize(model: UnifiedModel): Promise<void> {
    const entries = await readJsonLines<SessionEntry>(this.filePath);
    if (entries.length > 0) {
      if (this.headId) {
        const hasRequestedHead = entries.some((entry) => entry.id === this.headId);
        if (!hasRequestedHead) {
          throw new Error(`Unknown branch head: ${this.headId}`);
        }
      } else {
        this.headId = entries.at(-1)?.id;
      }
      return;
    }

    const entry: SessionEntry = {
      id: createId(),
      timestamp: now(),
      entryType: "metadata",
      payload: {
        cwd: this.cwd,
        model: model.modelId,
        provider: model.provider
      }
    };
    this.headId = entry.id;
    await appendJsonLine(this.filePath, entry);
  }

  async appendMessage(message: ConversationMessage): Promise<void> {
    const entryType: SessionEntryType = message.role === "user" ? "user" : message.role === "assistant" ? "assistant" : "tool";
    const entry: SessionEntry = {
      id: createId(),
      parentId: this.headId,
      timestamp: message.timestamp,
      entryType,
      payload: message as never
    };
    this.headId = entry.id;
    await appendJsonLine(this.filePath, entry);
  }

  async appendBranch(name?: string): Promise<string> {
    const entry: SessionEntry = {
      id: createId(),
      parentId: this.headId,
      timestamp: now(),
      entryType: "branch",
      payload: { name }
    };
    this.headId = entry.id;
    await appendJsonLine(this.filePath, entry);
    return entry.id;
  }

  async appendMemoryReference(plan: MemoryRecallPlan, reason: "auto" | "manual", query?: string): Promise<string> {
    const entry: SessionEntry = {
      id: createId(),
      parentId: this.headId,
      timestamp: now(),
      entryType: "memory_reference",
      payload: {
        memoryIds: plan.selectedIds,
        compactedIds: plan.compactedIds,
        rawPairIds: plan.rawPairIds,
        reason,
        query
      }
    };
    this.headId = entry.id;
    await appendJsonLine(this.filePath, entry);
    return entry.id;
  }

  async appendMemoryRecord(record: MemoryRecord): Promise<string> {
    const entry: SessionEntry = {
      id: createId(),
      parentId: this.headId,
      timestamp: record.createdAt,
      entryType: "memory_record",
      payload: {
        memoryId: record.id
      }
    };
    this.headId = entry.id;
    await appendJsonLine(this.filePath, entry);
    return entry.id;
  }

  async appendTaskState(task: TaskState): Promise<string> {
    const entry: SessionEntry = {
      id: createId(),
      parentId: this.headId,
      timestamp: now(),
      entryType: "task_state",
      payload: task
    };
    this.headId = entry.id;
    await appendJsonLine(this.filePath, entry);
    return entry.id;
  }

  async appendTaskSummary(result: TaskResult): Promise<string> {
    const entry: SessionEntry = {
      id: createId(),
      parentId: this.headId,
      timestamp: now(),
      entryType: "task_summary",
      payload: {
        status: result.status,
        summary: result.summary,
        verification: result.verification
      }
    };
    this.headId = entry.id;
    await appendJsonLine(this.filePath, entry);
    return entry.id;
  }

  async appendSessionCompression(result: SessionCompressionResult): Promise<string> {
    const entry: SessionEntry = {
      id: createId(),
      parentId: this.headId,
      timestamp: now(),
      entryType: "session_compression",
      payload: result
    };
    this.headId = entry.id;
    await appendJsonLine(this.filePath, entry);
    return entry.id;
  }

  async loadMessages(branchHeadId = this.headId): Promise<ConversationMessage[]> {
    const entries = await this.readEntries();
    if (!branchHeadId) {
      return entries
        .filter((entry) => entry.entryType === "user" || entry.entryType === "assistant" || entry.entryType === "tool")
        .map((entry) => entry.payload as ConversationMessage);
    }

    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const selected: SessionEntry[] = [];
    let current = byId.get(branchHeadId);
    while (current) {
      selected.push(current);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }

    return selected
      .reverse()
      .filter((entry) => entry.entryType === "user" || entry.entryType === "assistant" || entry.entryType === "tool")
      .map((entry) => entry.payload as ConversationMessage);
  }

  async checkout(branchHeadId?: string): Promise<ConversationMessage[]> {
    this.headId = branchHeadId;
    return this.loadMessages(branchHeadId);
  }

  async listBranchHeads(): Promise<Array<{ id: string; name?: string; timestamp: number }>> {
    const entries = await this.readEntries();
    return entries
      .filter((entry) => entry.entryType === "branch")
      .map((entry) => ({
        id: entry.id,
        name: (entry.payload as { name?: string }).name,
        timestamp: entry.timestamp
      }));
  }

  async listNodes(): Promise<SessionNodeSummary[]> {
    const entries = await this.readEntries();
    return entries
      .filter((entry) => entry.entryType !== "metadata")
      .map((entry) => ({
        id: entry.id,
        parentId: entry.parentId,
        entryType: entry.entryType,
        timestamp: entry.timestamp,
        label: summarizeEntry(entry)
      }));
  }

  async readEntries(): Promise<SessionEntry[]> {
    return readJsonLines<SessionEntry>(this.filePath);
  }

  async getMetadata(): Promise<{ cwd: string; model: string; provider: string } | undefined> {
    const entries = await this.readEntries();
    const metadata = entries.find((entry) => entry.entryType === "metadata");
    return metadata?.payload as { cwd: string; model: string; provider: string } | undefined;
  }

  static async listSessions(cwd: string, sessionsDir = getSessionsDir(cwd)): Promise<SessionSummary[]> {
    const paths = getMonoConfigPaths(cwd);
    let dir = join(sessionsDir, cwdSlug(cwd));
    let files = await readdir(dir).catch(() => []);
    if (files.length === 0 && sessionsDir === paths.globalSessionsDir) {
      dir = join(paths.legacyGlobalSessionsDir, cwdSlug(cwd));
      files = await readdir(dir).catch(() => []);
    }
    const summaries = await Promise.all(
      files
        .filter((file) => file.endsWith(".jsonl"))
        .map(async (file) => {
          const filePath = join(dir, file);
          const entries = await readJsonLines<SessionEntry>(filePath);
          const metadata = entries.find((entry) => entry.entryType === "metadata");
          const updatedAt = entries.at(-1)?.timestamp ?? 0;
          return {
            sessionId: file.replace(/\.jsonl$/, ""),
            filePath,
            updatedAt,
            cwd: (metadata?.payload as { cwd?: string } | undefined)?.cwd ?? cwd
          } satisfies SessionSummary;
        })
    );
    return summaries.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  static async latestForCwd(cwd: string, sessionsDir = getSessionsDir(cwd)): Promise<SessionSummary | undefined> {
    const sessions = await SessionManager.listSessions(cwd, sessionsDir);
    return sessions[0];
  }

  static rootDirFromSessionFile(filePath: string): string {
    return dirname(dirname(filePath));
  }
}

function summarizeEntry(entry: SessionEntry): string {
  if (entry.entryType === "branch") {
    return `branch ${(entry.payload as { name?: string }).name ?? entry.id.slice(0, 8)}`;
  }

  if (entry.entryType === "user") {
    const content = (entry.payload as ConversationMessage).content;
    return typeof content === "string" ? content.slice(0, 80) : "[user attachments]";
  }

  if (entry.entryType === "assistant") {
    const payload = entry.payload as ConversationMessage;
    if (payload.role !== "assistant") {
      return "assistant";
    }
    const text = payload.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join(" ");
    const toolCalls = payload.content
      .filter((part) => part.type === "tool-call")
      .map((part) => part.name);
    if (text) {
      return text.slice(0, 80);
    }
    if (toolCalls.length > 0) {
      return `tool calls: ${toolCalls.join(", ")}`;
    }
    return "assistant";
  }

  if (entry.entryType === "task_state") {
    const payload = entry.payload as TaskState;
    const current = payload.todos.find((todo) => todo.status === "in_progress");
    return `task ${payload.phase}: ${current?.description ?? payload.goal.slice(0, 60)}`;
  }

  if (entry.entryType === "task_summary") {
    const payload = entry.payload as { status: TaskResult["status"]; summary: string };
    return `summary [${payload.status}] ${payload.summary.slice(0, 80)}`;
  }

  if (entry.entryType === "session_compression") {
    const payload = entry.payload as SessionCompressionResult;
    return `compressed ${payload.replacedMessageCount} messages`;
  }

  if (entry.entryType === "tool") {
    const payload = entry.payload as ConversationMessage;
    return payload.role === "tool" ? `tool result: ${payload.toolName}` : "tool";
  }

  if (entry.entryType === "label") {
    return `label ${(entry.payload as { label: string }).label}`;
  }

  if (entry.entryType === "compaction") {
    return "compaction";
  }

  if (entry.entryType === "memory_reference") {
    const payload = entry.payload as { memoryIds: string[]; reason: "auto" | "manual" };
    return `memory ${payload.reason}: ${payload.memoryIds.length} recalled`;
  }

  if (entry.entryType === "memory_record") {
    return `memory saved: ${(entry.payload as { memoryId: string }).memoryId}`;
  }

  return entry.entryType;
}
