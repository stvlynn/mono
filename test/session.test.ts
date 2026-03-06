import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../packages/session/src/index.js";
import type { UnifiedModel } from "../packages/shared/src/index.js";

const model: UnifiedModel = {
  provider: "openai",
  modelId: "gpt-4.1-mini",
  family: "openai-compatible",
  baseURL: "https://api.openai.com/v1",
  apiKeyEnv: "OPENAI_API_KEY",
  supportsTools: true,
  supportsReasoning: true
};

describe("session manager", () => {
  it("writes and reloads conversation messages", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-session-"));
    const sessionsDir = join(cwd, ".sessions");
    const manager = new SessionManager({ cwd, sessionsDir, sessionId: "session-a" });
    await manager.initialize(model);
    await manager.appendMessage({
      role: "user",
      content: "hello",
      timestamp: Date.now()
    });
    await manager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "world" }],
      provider: "openai",
      model: "gpt-4.1-mini",
      stopReason: "stop",
      timestamp: Date.now()
    });

    const messages = await manager.loadMessages();
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe("user");
    expect(messages[1].role).toBe("assistant");
  });

  it("lists the latest session for a workspace", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-session-"));
    const sessionsDir = join(cwd, ".sessions");
    const first = new SessionManager({ cwd, sessionsDir, sessionId: "first" });
    await first.initialize(model);
    await first.appendMessage({
      role: "user",
      content: "one",
      timestamp: Date.now()
    });

    const second = new SessionManager({ cwd, sessionsDir, sessionId: "second" });
    await second.initialize(model);
    await second.appendMessage({
      role: "user",
      content: "two",
      timestamp: Date.now() + 1
    });

    const latest = await SessionManager.latestForCwd(cwd, sessionsDir);
    expect(latest?.sessionId).toBe("second");
  });

  it("records memory references and persisted memory ids without affecting message replay", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-session-"));
    const sessionsDir = join(cwd, ".sessions");
    const manager = new SessionManager({ cwd, sessionsDir, sessionId: "session-memory" });
    await manager.initialize(model);
    await manager.appendMessage({
      role: "user",
      content: "remember this task",
      timestamp: Date.now()
    });
    await manager.appendMemoryReference(
      {
        rootIds: ["mem-root"],
        compactedIds: ["mem-root"],
        rawPairIds: [],
        selectedIds: ["mem-root"]
      },
      "auto"
    );
    await manager.appendMemoryRecord({
      id: "mem-new",
      createdAt: Date.now(),
      projectKey: "project",
      sessionId: "session-memory",
      parents: ["mem-root"],
      children: [],
      referencedMemoryIds: ["mem-root"],
      input: "remember this task",
      compacted: ["Received request: remember this task"],
      output: "Done",
      detailed: [{ type: "user", text: "remember this task" }],
      tags: [],
      files: [],
      tools: []
    });

    const entries = await manager.readEntries();
    const messages = await manager.loadMessages();

    expect(entries.some((entry) => entry.entryType === "memory_reference")).toBe(true);
    expect(entries.some((entry) => entry.entryType === "memory_record")).toBe(true);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.role).toBe("user");
  });

  it("records task state, compression, and task summary entries", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-session-"));
    const sessionsDir = join(cwd, ".sessions");
    const manager = new SessionManager({ cwd, sessionsDir, sessionId: "session-task" });
    await manager.initialize(model);
    await manager.appendTaskState({
      taskId: "task-1",
      goal: "fix failing tests",
      phase: "execute",
      attempts: 1,
      todos: [
        { id: "execute", description: "Execute the required work", status: "in_progress" },
        { id: "verify", description: "Verify the result", status: "pending" }
      ],
      verification: {
        mode: "strict",
        evidence: []
      }
    });
    await manager.appendSessionCompression({
      summary: "Compressed earlier turns into a short summary.",
      preservedRecentMessages: 8,
      replacedMessageCount: 5,
      tokenEstimateBefore: 1200,
      tokenEstimateAfter: 300
    });
    await manager.appendTaskSummary({
      status: "done",
      summary: "Tests were fixed and verification passed.",
      turns: 2,
      verification: {
        mode: "strict",
        passed: true,
        reason: "vitest passed",
        evidence: ["bash: vitest passed with 0 failed"],
        lastCheckedAt: Date.now()
      },
      messages: []
    });

    const entries = await manager.readEntries();
    const labels = await manager.listNodes();

    expect(entries.some((entry) => entry.entryType === "task_state")).toBe(true);
    expect(entries.some((entry) => entry.entryType === "session_compression")).toBe(true);
    expect(entries.some((entry) => entry.entryType === "task_summary")).toBe(true);
    expect(labels.some((node) => node.label.includes("task execute"))).toBe(true);
    expect(labels.some((node) => node.label.includes("compressed 5 messages"))).toBe(true);
    expect(labels.some((node) => node.label.includes("summary [done]"))).toBe(true);
  });

  it("preserves an explicit branch head during initialization", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-session-"));
    const sessionsDir = join(cwd, ".sessions");
    const first = new SessionManager({ cwd, sessionsDir, sessionId: "session-branch" });
    await first.initialize(model);
    await first.appendMessage({
      role: "user",
      content: "base",
      timestamp: Date.now()
    });
    const branchHeadId = await first.appendBranch("feature");

    const second = new SessionManager({ cwd, sessionsDir, sessionId: "session-branch", branchHeadId });
    await second.initialize(model);

    expect(second.getHeadId()).toBe(branchHeadId);
  });

  it("throws when initializing with an unknown branch head", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-session-"));
    const sessionsDir = join(cwd, ".sessions");
    const manager = new SessionManager({ cwd, sessionsDir, sessionId: "session-unknown" });
    await manager.initialize(model);

    const reopened = new SessionManager({ cwd, sessionsDir, sessionId: "session-unknown", branchHeadId: "missing-head" });
    await expect(reopened.initialize(model)).rejects.toThrow("Unknown branch head: missing-head");
  });
});
