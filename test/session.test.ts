import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../packages/session/src/index.js";
import type { UnifiedModel } from "../packages/shared/src/index.js";
import { createTestUnifiedModel, describeIfRealTestModel } from "./helpers/test-model-env.js";

const model: UnifiedModel = createTestUnifiedModel();

describeIfRealTestModel("session manager", () => {
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

  it("persists transport-aware session metadata for later transcript repair", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-session-"));
    const sessionsDir = join(cwd, ".sessions");
    const manager = new SessionManager({ cwd, sessionsDir, sessionId: "session-metadata-rich" });
    await manager.initialize(model);

    const metadata = await manager.getMetadata();

    expect(metadata?.provider).toBe(model.provider);
    expect(metadata?.model).toBe(model.modelId);
    expect(metadata?.family).toBe(model.family);
    expect(metadata?.transport).toBe(model.transport);
    expect(metadata?.baseURL).toBe(model.baseURL);
  });

  it("serializes concurrent appends against the same session file", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-session-"));
    const sessionsDir = join(cwd, ".sessions");
    const first = new SessionManager({ cwd, sessionsDir, sessionId: "shared-session" });
    const second = new SessionManager({ cwd, sessionsDir, sessionId: "shared-session" });
    await first.initialize(model);
    await second.initialize(model);

    await Promise.all([
      first.appendMessage({
        role: "user",
        content: "from first",
        timestamp: Date.now(),
      }),
      second.appendMessage({
        role: "user",
        content: "from second",
        timestamp: Date.now() + 1,
      }),
    ]);

    const messages = await first.loadMessages();
    expect(messages).toHaveLength(2);
    expect(messages.map((message) => message.role)).toEqual(["user", "user"]);
    expect(messages
      .map((message) => typeof message.content === "string" ? message.content : "[parts]")
      .sort()).toEqual(["from first", "from second"]);
  });

  it("persists user message metadata so channel history can recover native resources", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-session-"));
    const sessionsDir = join(cwd, ".sessions");
    const manager = new SessionManager({ cwd, sessionsDir, sessionId: "session-metadata" });
    await manager.initialize(model);
    await manager.appendMessage({
      role: "user",
      content: [{ type: "text", text: "<media:sticker>" }],
      timestamp: Date.now(),
      metadata: {
        telegram: {
          sticker: {
            fileId: "CAAC123",
            fileUniqueId: "unique-1",
            emoji: "🙂",
            setName: "CatsPack",
          },
        },
      },
    });

    const entries = await manager.readEntries();
    const userEntry = entries.find((entry) => entry.entryType === "user");
    const messages = await manager.loadMessages();
    const userMessage = messages[0] as { role: string; metadata?: { telegram?: { sticker?: { fileId?: string } } } };

    expect((userEntry?.payload as { metadata?: { telegram?: { sticker?: { fileId?: string } } } })?.metadata?.telegram?.sticker?.fileId).toBe("CAAC123");
    expect(userMessage.metadata?.telegram?.sticker?.fileId).toBe("CAAC123");
  });

  it("persists autonomy triggers separately from ordinary user entries while preserving replay order", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-session-"));
    const sessionsDir = join(cwd, ".sessions");
    const manager = new SessionManager({ cwd, sessionsDir, sessionId: "session-autonomy" });
    await manager.initialize(model);
    await manager.appendAutonomyTrigger({
      role: "user",
      content: "Resume and finish: fix the failing test",
      timestamp: Date.now(),
      origin: "heartbeat",
      parentIntentId: "intent-1",
    });

    const entries = await manager.readEntries();
    const messages = await manager.loadMessages();

    expect(entries.some((entry) => entry.entryType === "autonomy_trigger")).toBe(true);
    expect(entries.some((entry) => entry.entryType === "user")).toBe(false);
    expect(messages[0]?.role).toBe("user");
    if (messages[0]?.role === "user") {
      expect(messages[0].origin).toBe("heartbeat");
      expect(messages[0].parentIntentId).toBe("intent-1");
    }
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

    const threads = await SessionManager.listThreads(cwd, sessionsDir);
    const latestThread = await SessionManager.latestThreadForCwd(cwd, sessionsDir);
    expect(threads[0]?.sessionId).toBe("second");
    expect(latestThread?.sessionId).toBe("second");
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

  it("records task pointer, compression, and task summary entries", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-session-"));
    const sessionsDir = join(cwd, ".sessions");
    const manager = new SessionManager({ cwd, sessionsDir, sessionId: "session-task" });
    await manager.initialize(model);
    await manager.appendTaskPointer({
      taskId: "task-1",
      todoMemoryId: "todo-1",
      goal: "fix failing tests",
      phase: "execute",
      attempts: 1,
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
      taskId: "task-1",
      todoMemoryId: "todo-1",
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

    expect(entries.some((entry) => entry.entryType === "task_pointer")).toBe(true);
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

  it("reads only entries reachable from the selected branch head", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "mono-session-"));
    const sessionsDir = join(cwd, ".sessions");
    const manager = new SessionManager({ cwd, sessionsDir, sessionId: "session-branches" });
    await manager.initialize(model);
    await manager.appendMessage({
      role: "user",
      content: "base",
      timestamp: Date.now()
    });

    const baseHeadId = manager.getHeadId()!;
    await manager.appendBranch("feature-a");
    await manager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "branch a" }],
      provider: "openai",
      model: "gpt-4.1-mini",
      stopReason: "stop",
      timestamp: Date.now()
    });
    const branchAHeadId = manager.getHeadId()!;

    await manager.checkout(baseHeadId);
    await manager.appendBranch("feature-b");
    await manager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "branch b" }],
      provider: "openai",
      model: "gpt-4.1-mini",
      stopReason: "stop",
      timestamp: Date.now() + 1
    });

    const reachable = await manager.readEntriesForHead(branchAHeadId);
    const labels = reachable.map((entry) => entry.entryType === "assistant" ? JSON.stringify(entry.payload) : entry.entryType);

    expect(labels.some((label) => label.includes("branch a"))).toBe(true);
    expect(labels.some((label) => label.includes("branch b"))).toBe(false);
  });
});
