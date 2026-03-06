import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTaskTodoRecord } from "../packages/agent-core/src/memory-runtime.js";

async function createAgentConfig(rootDir: string, options?: { memoryEnabled?: boolean }): Promise<string> {
  const configDir = join(rootDir, ".mono");
  await mkdir(configDir, { recursive: true });
  await writeFile(
    join(configDir, "config.json"),
    JSON.stringify({
      version: 1,
      mono: {
        defaultProfile: "default",
        profiles: {
          default: {
            provider: "openai",
            modelId: "gpt-4.1-mini",
            baseURL: "https://api.openai.com/v1",
            family: "openai-compatible",
            transport: "xsai-openai-compatible",
            supportsTools: true,
            supportsReasoning: true
          }
        },
        memory: {
          enabled: options?.memoryEnabled ?? true,
          autoInject: options?.memoryEnabled ?? true,
          storePath: ".mono/memories",
          latestRoots: 4,
          compactedLevelNum: 1,
          rawPairLevelNum: 3,
          compactedCapNum: 8,
          rawPairCapNum: 8,
          keywordSearchLimit: 6
        }
      }
    }),
    "utf8"
  );
  return configDir;
}

describe("Agent", () => {
  it("aborts the active controller", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    process.env.MONO_CONFIG_DIR = await createAgentConfig(rootDir);

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const agent = new Agent({ cwd });
    await agent.initialize();

    const controller = new AbortController();
    (agent as { activeRun?: { id: number; controller: AbortController } }).activeRun = {
      id: 1,
      controller
    };

    expect(agent.isRunning()).toBe(true);
    agent.abort();
    expect(controller.signal.aborted).toBe(true);

    delete process.env.MONO_CONFIG_DIR;
  });

  it("blocks switching profile and session while a run is active", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    process.env.MONO_CONFIG_DIR = await createAgentConfig(rootDir);

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const agent = new Agent({ cwd });
    await agent.initialize();

    (agent as { activeRun?: { id: number; controller: AbortController } }).activeRun = {
      id: 1,
      controller: new AbortController()
    };

    await expect(agent.setProfile("default")).rejects.toThrow("Cannot switch profile while agent is running");
    await expect(agent.switchSession("other")).rejects.toThrow("Cannot switch session while agent is running");

    delete process.env.MONO_CONFIG_DIR;
  });

  it("does not persist memory when memory is disabled", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    process.env.MONO_CONFIG_DIR = await createAgentConfig(rootDir, { memoryEnabled: false });

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const agent = new Agent({ cwd });
    await agent.initialize();

    await (agent as { persistTaskMemory: (context: unknown) => Promise<void> }).persistTaskMemory({
      runId: 1,
      controller: new AbortController(),
      session: (agent as { state: { session: unknown } }).state.session,
      model: (agent as { state: { model: unknown } }).state.model,
      userMessage: {
        role: "user",
        content: "fix bug",
        timestamp: Date.now()
      },
      taskMessages: [
        {
          role: "assistant",
          provider: "openai",
          model: "gpt-4.1-mini",
          stopReason: "stop",
          timestamp: Date.now(),
          content: [{ type: "text", text: "done" }]
        }
      ],
      recallAccumulator: {
        rootIds: new Set(),
        compactedIds: new Set(),
        rawPairIds: new Set(),
        selectedIds: new Set()
      }
    });

    expect(await agent.countMemories()).toBe(0);
    const entries = await (agent as { state: { session: { readEntries: () => Promise<Array<{ entryType: string }>> } } }).state.session.readEntries();
    expect(entries.some((entry) => entry.entryType === "memory_record")).toBe(false);

    delete process.env.MONO_CONFIG_DIR;
  });

  it("clears stale currentTask when switching to a session without task state", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    process.env.MONO_CONFIG_DIR = await createAgentConfig(rootDir);

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const { SessionManager } = await import("../packages/session/src/index.js");
    const agent = new Agent({ cwd });
    await agent.initialize();

    const internalState = (agent as {
      state: {
        session: InstanceType<typeof SessionManager>;
        taskTodoStore: { upsert: (record: ReturnType<typeof createTaskTodoRecord>) => Promise<void> };
      };
    }).state;
    const currentSession = internalState.session;
    const todoRecord = createTaskTodoRecord({
      taskId: "task-1",
      goal: "fix issue",
      sessionId: currentSession.sessionId,
      branchHeadId: currentSession.getHeadId(),
      cwd,
      verificationMode: "strict",
      todos: [{ id: "execute", description: "Execute the required work", status: "in_progress" }]
    });
    await internalState.taskTodoStore.upsert(todoRecord);
    await currentSession.appendTaskPointer({
      taskId: "task-1",
      todoMemoryId: todoRecord.id,
      goal: "fix issue",
      phase: "execute",
      attempts: 1,
      verification: { mode: "strict", evidence: [] }
    });
    (agent as { state: { currentTask?: { taskId: string } } }).state.currentTask = {
      taskId: "task-1"
    } as never;

    const otherSession = new SessionManager({
      cwd,
      sessionsDir: SessionManager.rootDirFromSessionFile(currentSession.filePath),
      sessionId: "other-session"
    });
    await otherSession.initialize((agent as { state: { model: unknown } }).state.model as never);
    await otherSession.appendMessage({
      role: "user",
      content: "plain session",
      timestamp: Date.now()
    });

    await agent.switchSession("other-session");

    expect(agent.getCurrentTask()).toBeUndefined();

    delete process.env.MONO_CONFIG_DIR;
  });

  it("reloads currentTask when switching branches", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    process.env.MONO_CONFIG_DIR = await createAgentConfig(rootDir);

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const agent = new Agent({ cwd });
    await agent.initialize();
    const internalState = (agent as {
      state: {
        session: {
          sessionId: string;
          getHeadId: () => string | undefined;
          appendTaskPointer: (pointer: unknown) => Promise<void>;
          appendBranch: (name?: string) => Promise<string>;
        };
        taskTodoStore: { upsert: (record: ReturnType<typeof createTaskTodoRecord>) => Promise<void> };
      };
    }).state;
    const session = internalState.session;

    const mainTodo = createTaskTodoRecord({
      taskId: "task-main",
      goal: "main branch task",
      sessionId: session.sessionId,
      branchHeadId: session.getHeadId(),
      cwd,
      verificationMode: "strict",
      todos: [{ id: "execute", description: "Main task", status: "in_progress" }]
    });
    await internalState.taskTodoStore.upsert(mainTodo);
    await session.appendTaskPointer({
      taskId: "task-main",
      todoMemoryId: mainTodo.id,
      goal: "main branch task",
      phase: "execute",
      attempts: 1,
      verification: { mode: "strict", evidence: [] }
    });
    const branchHeadId = await session.appendBranch("feature");
    const featureTodo = createTaskTodoRecord({
      taskId: "task-feature",
      goal: "feature branch task",
      sessionId: session.sessionId,
      branchHeadId,
      cwd,
      verificationMode: "strict",
      todos: [{ id: "verify", description: "Verify the result", status: "in_progress" }]
    });
    await internalState.taskTodoStore.upsert(featureTodo);
    await session.appendTaskPointer({
      taskId: "task-feature",
      todoMemoryId: featureTodo.id,
      goal: "feature branch task",
      phase: "verify",
      attempts: 2,
      verification: { mode: "strict", evidence: [] }
    });

    await agent.switchBranch(branchHeadId);

    expect(agent.getCurrentTask()?.taskId).toBe("task-main");

    delete process.env.MONO_CONFIG_DIR;
  });
});
