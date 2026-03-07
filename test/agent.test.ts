import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTaskTodoRecord } from "../packages/agent-core/src/memory-runtime.js";
import type { MemoryRecord } from "../packages/shared/src/index.js";

async function createAgentConfig(rootDir: string, options?: { memoryEnabled?: boolean; memory?: Record<string, unknown> }): Promise<string> {
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
          keywordSearchLimit: 6,
          ...options?.memory
        }
      }
    }),
    "utf8"
  );
  return configDir;
}

function createMemoryRecord(overrides: Partial<MemoryRecord> & Pick<MemoryRecord, "id" | "createdAt" | "input" | "output" | "compacted">): MemoryRecord {
  return {
    id: overrides.id,
    createdAt: overrides.createdAt,
    projectKey: overrides.projectKey ?? "project",
    sessionId: overrides.sessionId,
    branchHeadId: overrides.branchHeadId,
    parents: overrides.parents ?? [],
    children: overrides.children ?? [],
    referencedMemoryIds: overrides.referencedMemoryIds ?? [],
    input: overrides.input,
    compacted: overrides.compacted,
    output: overrides.output,
    detailed: overrides.detailed ?? [],
    tags: overrides.tags ?? [],
    files: overrides.files ?? [],
    tools: overrides.tools ?? []
  };
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
    (agent as unknown as { activeRun?: { id: number; controller: AbortController } }).activeRun = {
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

    (agent as unknown as { activeRun?: { id: number; controller: AbortController } }).activeRun = {
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

    await (agent as unknown as { persistTaskMemory: (context: unknown) => Promise<void> }).persistTaskMemory({
      runId: 1,
      controller: new AbortController(),
      session: (agent as unknown as { state: { session: unknown } }).state.session,
      model: (agent as unknown as { state: { model: unknown } }).state.model,
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
    const entries = await (agent as unknown as { state: { session: { readEntries: () => Promise<Array<{ entryType: string }>> } } }).state.session.readEntries();
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

    const internalState = (agent as unknown as {
      state: {
        session: {
          sessionId: string;
          filePath: string;
          getHeadId: () => string | undefined;
          appendTaskPointer: (pointer: unknown) => Promise<string>;
        };
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
    (agent as unknown as { state: { currentTask?: { taskId: string } } }).state.currentTask = {
      taskId: "task-1"
    } as never;

    const otherSession = new SessionManager({
      cwd,
      sessionsDir: SessionManager.rootDirFromSessionFile(currentSession.filePath),
      sessionId: "other-session"
    });
    await otherSession.initialize((agent as unknown as { state: { model: unknown } }).state.model as never);
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
    const internalState = (agent as unknown as {
      state: {
        session: {
          sessionId: string;
          getHeadId: () => string | undefined;
          appendTaskPointer: (pointer: unknown) => Promise<string>;
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

  it("falls back to local auto-injected memory when the configured backend fails", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    process.env.MONO_CONFIG_DIR = await createAgentConfig(rootDir, {
      memory: {
        retrievalBackend: "openviking",
        fallbackToLocalOnFailure: true,
        openViking: {
          enabled: true,
          url: "https://openviking.example"
        }
      }
    });

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const agent = new Agent({ cwd });
    await agent.initialize();

    const internalState = (agent as unknown as {
      state: {
        session: { sessionId: string; getHeadId: () => string | undefined };
        memoryStore: { append: (record: MemoryRecord) => Promise<void> };
        model: unknown;
      };
      createConfiguredMemoryRetrievalProvider: () => Promise<unknown>;
      loadMemoryContextForTaskTurn: (context: unknown) => Promise<string>;
    });

    await internalState.state.memoryStore.append(
      createMemoryRecord({
        id: "mem-local",
        createdAt: Date.now(),
        sessionId: internalState.state.session.sessionId,
        branchHeadId: internalState.state.session.getHeadId(),
        input: "inspect memory runtime",
        output: "used local fallback",
        compacted: ["Recovered from external retrieval failure"]
      })
    );

    internalState.createConfiguredMemoryRetrievalProvider = async () => {
      throw new Error("backend offline");
    };

    const context = {
      runId: 1,
      controller: new AbortController(),
      session: internalState.state.session,
      model: internalState.state.model,
      userMessage: {
        role: "user",
        content: "inspect memory runtime",
        timestamp: Date.now()
      },
      taskMessages: [],
      recallAccumulator: {
        rootIds: new Set<string>(),
        compactedIds: new Set<string>(),
        rawPairIds: new Set<string>(),
        selectedIds: new Set<string>()
      },
      taskTodoRecord: null,
      taskTodosDirty: false
    };

    const memoryContext = await internalState.loadMemoryContextForTaskTurn(context);

    expect(memoryContext).toContain("mem-local");
    expect(context.recallAccumulator.selectedIds.has("mem-local")).toBe(true);

    delete process.env.MONO_CONFIG_DIR;
  });

  it("runs OpenViking shadow export only when shadowExport is enabled", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    process.env.MONO_CONFIG_DIR = await createAgentConfig(rootDir, {
      memory: {
        openViking: {
          enabled: true,
          url: "https://openviking.example",
          shadowExport: true
        }
      }
    });

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const agent = new Agent({ cwd });
    await agent.initialize();

    const exported: string[] = [];
    const internalAgent = agent as unknown as {
      state: {
        config: {
          memory: {
            openViking: { enabled: boolean; url?: string; shadowExport: boolean };
            seekDb: { enabled: boolean };
          };
        };
        session: unknown;
      };
      loadOpenVikingAdapterModule: () => Promise<unknown>;
      syncConfiguredMemoryBackends: (record: MemoryRecord, session: unknown) => Promise<void>;
    };

    internalAgent.loadOpenVikingAdapterModule = async () => ({
      OpenVikingShadowExporter: class {
        async exportRecord(record: MemoryRecord): Promise<void> {
          exported.push(record.id);
        }
      }
    });

    const record = createMemoryRecord({
      id: "mem-shadow",
      createdAt: Date.now(),
      sessionId: "session-shadow",
      input: "shadow this memory",
      output: "shadow exported",
      compacted: ["Shadow export ready"]
    });

    await internalAgent.syncConfiguredMemoryBackends(record, internalAgent.state.session);
    expect(exported).toEqual(["mem-shadow"]);

    internalAgent.state.config.memory.openViking.shadowExport = false;
    exported.length = 0;
    await internalAgent.syncConfiguredMemoryBackends(record, internalAgent.state.session);
    expect(exported).toEqual([]);

    delete process.env.MONO_CONFIG_DIR;
  });

  it("mirrors SeekDB sessions without exporting execution memory when mirrorSessionsOnly is enabled", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    process.env.MONO_CONFIG_DIR = await createAgentConfig(rootDir, {
      memory: {
        seekDb: {
          enabled: true,
          mode: "mysql",
          database: "mono_eval",
          mirrorSessionsOnly: true
        }
      }
    });

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const agent = new Agent({ cwd });
    await agent.initialize();

    const mirrored: string[] = [];
    const exported: string[] = [];
    const internalAgent = agent as unknown as {
      state: {
        config: {
          memory: {
            openViking: { enabled: boolean };
            seekDb: {
              enabled: boolean;
              mode: "mysql" | "python-embedded";
              database?: string;
              mirrorSessionsOnly: boolean;
            };
          };
        };
        session: { sessionId: string; getHeadId: () => string | undefined; readEntries: () => Promise<unknown[]> };
      };
      loadSeekDbAdapterModule: () => Promise<unknown>;
      syncConfiguredMemoryBackends: (record: MemoryRecord, session: unknown) => Promise<void>;
    };

    internalAgent.loadSeekDbAdapterModule = async () => ({
      SeekDbSessionMirror: class {
        async mirrorSession(input: { sessionId: string }): Promise<void> {
          mirrored.push(input.sessionId);
        }
      },
      SeekDbExecutionMemoryBackend: class {
        async append(record: MemoryRecord): Promise<void> {
          exported.push(record.id);
        }
      }
    });

    const record = createMemoryRecord({
      id: "mem-seekdb",
      createdAt: Date.now(),
      sessionId: internalAgent.state.session.sessionId,
      branchHeadId: internalAgent.state.session.getHeadId(),
      input: "mirror this session",
      output: "mirrored",
      compacted: ["Session mirrored into SeekDB"]
    });

    await internalAgent.syncConfiguredMemoryBackends(record, internalAgent.state.session);
    expect(mirrored).toEqual([internalAgent.state.session.sessionId]);
    expect(exported).toEqual([]);

    internalAgent.state.config.memory.seekDb.mirrorSessionsOnly = false;
    await internalAgent.syncConfiguredMemoryBackends(record, internalAgent.state.session);
    expect(exported).toEqual(["mem-seekdb"]);

    delete process.env.MONO_CONFIG_DIR;
  });
});
