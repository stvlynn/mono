import { mkdtemp, mkdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTaskTodoRecord } from "../packages/agent-core/src/memory-runtime.js";
import type { MemoryRecord, TaskResult } from "../packages/shared/src/index.js";
import { createTestProfileConfig, describeIfRealTestModel, getTestModelSelectionString } from "./helpers/test-model-env.js";

async function createAgentConfig(rootDir: string, options?: {
  memoryEnabled?: boolean;
  memory?: Record<string, unknown>;
  channels?: Record<string, unknown>;
  settings?: Record<string, unknown>;
}): Promise<string> {
  const configDir = join(rootDir, ".mono");
  const testProfile = createTestProfileConfig();
  await mkdir(configDir, { recursive: true });
  await writeFile(
    join(configDir, "config.json"),
    JSON.stringify({
      version: 1,
      mono: {
        defaultProfile: "default",
        profiles: {
          default: testProfile
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
        },
        settings: options?.settings,
        channels: options?.channels
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

describeIfRealTestModel("Agent", () => {
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.MONO_CONFIG_DIR;
  });

  it("preserves the original session id when updating an existing todo record", () => {
    const existing = createTaskTodoRecord({
      taskId: "task-1",
      goal: "Fix the failing test",
      sessionId: "main-session",
      branchHeadId: "main-head",
      cwd: "/tmp/project",
      verificationMode: "strict",
      todos: [{ id: "todo-1", description: "Inspect the failure", status: "in_progress" }],
    });

    const updated = createTaskTodoRecord({
      taskId: "task-1",
      goal: "Fix the failing test",
      sessionId: "isolated-session",
      branchHeadId: "isolated-head",
      cwd: "/tmp/project",
      verificationMode: "strict",
      existing,
      todos: [{ id: "todo-1", description: "Rerun the test", status: "in_progress" }],
    });

    expect(updated.sessionId).toBe("main-session");
    expect(updated.branchHeadId).toBe("main-head");
  });

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

    await (agent as unknown as {
      persistTaskMemory: (context: unknown, task: unknown, result: unknown, options: unknown) => Promise<void>;
    }).persistTaskMemory({
      runId: 1,
      controller: new AbortController(),
      session: (agent as unknown as { state: { session: unknown } }).state.session,
      model: (agent as unknown as { state: { model: unknown } }).state.model,
      interactionMode: "default",
      input: { text: "fix bug" },
      extraTaskContext: undefined,
      channelContext: null,
      channelActionRequirement: undefined,
      channelActionFeedback: undefined,
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
      },
      taskTodoRecord: null,
      taskTodosDirty: false,
      sandboxMode: "danger-full-access",
      approvalPolicy: "never",
      origin: "user"
    }, {
      taskId: "task-1",
      goal: "fix bug",
      phase: "summarize",
      attempts: 1,
      verification: { mode: "strict", evidence: [], passed: true }
    }, {
      taskId: "task-1",
      status: "done",
      summary: "done",
      turns: 1,
      verification: { mode: "strict", evidence: [], passed: true },
      messages: []
    }, {
      loopDetected: false,
      leaseExceeded: false,
      diagnosis: null
    });

    expect(await agent.countMemories()).toBe(0);
    const entries = await (agent as unknown as { state: { session: { readEntries: () => Promise<Array<{ entryType: string }>> } } }).state.session.readEntries();
    expect(entries.some((entry) => entry.entryType === "memory_record")).toBe(false);

    delete process.env.MONO_CONFIG_DIR;
  });

  it("injects structured memory context into inspectContext after persisting a turn", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    process.env.MONO_CONFIG_DIR = await createAgentConfig(rootDir);

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const agent = new Agent({ cwd });
    await agent.initialize();

    await (agent as unknown as {
      persistTaskMemory: (context: unknown, task: unknown, result: unknown, options: unknown) => Promise<void>;
    }).persistTaskMemory({
      runId: 1,
      controller: new AbortController(),
      session: (agent as unknown as { state: { session: unknown } }).state.session,
      model: (agent as unknown as { state: { model: unknown } }).state.model,
      interactionMode: "default",
      input: { text: "请直接一点，不要自作主张地总结。" },
      extraTaskContext: undefined,
      channelContext: null,
      channelActionRequirement: undefined,
      channelActionFeedback: undefined,
      userMessage: {
        role: "user",
        content: "请直接一点，不要自作主张地总结。",
        timestamp: Date.now()
      },
      taskMessages: [
        {
          role: "assistant",
          provider: "openai",
          model: "gpt-4.1-mini",
          stopReason: "stop",
          timestamp: Date.now(),
          content: [{ type: "text", text: "后续会更直接，不再擅自总结。" }]
        }
      ],
      recallAccumulator: {
        rootIds: new Set(),
        compactedIds: new Set(),
        rawPairIds: new Set(),
        selectedIds: new Set()
      },
      taskTodoRecord: null,
      taskTodosDirty: false,
      sandboxMode: "danger-full-access",
      approvalPolicy: "never",
      origin: "user"
    }, {
      taskId: "task-2",
      goal: "请直接一点，不要自作主张地总结。",
      phase: "summarize",
      attempts: 1,
      verification: { mode: "light", evidence: [], passed: true }
    }, {
      taskId: "task-2",
      status: "done",
      summary: "done",
      turns: 1,
      verification: { mode: "light", evidence: [], passed: true },
      messages: []
    }, {
      loopDetected: false,
      leaseExceeded: false,
      diagnosis: null
    });

    const inspected = await agent.inspectContext("直接回答");
    const structured = await agent.inspectStructuredMemory();

    expect(inspected.systemPrompt).toContain("<StructuredMemoryContext");
    expect(inspected.systemPrompt).toContain("prefers_directness");
    expect(structured.feedbackSignals.length).toBeGreaterThan(0);
    expect(structured.learningState.strategyStats.length).toBeGreaterThan(0);

    delete process.env.MONO_CONFIG_DIR;
  });

  it("runs a manual heartbeat and returns a noop decision when no autonomy candidates exist", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-heartbeat-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    process.env.MONO_CONFIG_DIR = await createAgentConfig(rootDir);

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const agent = new Agent({ cwd });
    await agent.initialize();

    const heartbeat = await agent.runHeartbeatOnce();
    const structured = await agent.inspectStructuredMemory();

    expect(heartbeat.decision?.decision).toBe("noop");
    expect(heartbeat.triggeredIntent).toBeUndefined();
    expect(structured.heartbeatDecisions.length).toBeGreaterThan(0);
    expect(structured.heartbeatDecisions[0]?.decision).toBe("noop");

    delete process.env.MONO_CONFIG_DIR;
  });

  it("syncs the heartbeat hourly cap from resolved settings into self runtime", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-heartbeat-settings-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    process.env.MONO_CONFIG_DIR = await createAgentConfig(rootDir, {
      settings: {
        autonomy: {
          enabled: true,
          heartbeatIntervalMs: 45_000,
          maxAutonomousTasksPerHour: 2,
          allowBroadExecution: false,
          isolatedSession: false,
        },
      },
    });

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const agent = new Agent({ cwd });
    await agent.initialize();

    const structured = await agent.inspectStructuredMemory();
    expect(structured.selfRuntime.autonomyPolicy).toMatchObject({
      heartbeatIntervalMs: 45_000,
      maxAutonomousTasksPerHour: 2,
      allowBroadExecution: false,
      isolatedSession: false,
    });

    delete process.env.MONO_CONFIG_DIR;
  });

  it("does not schedule automatic heartbeat work when heartbeat is disabled", async () => {
    vi.useFakeTimers();
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-heartbeat-disabled-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    process.env.MONO_CONFIG_DIR = await createAgentConfig(rootDir);

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const agent = new Agent({ cwd, heartbeatEnabled: false });
    await agent.initialize();

    await vi.advanceTimersByTimeAsync(35_000);

    const structured = await agent.inspectStructuredMemory();
    expect(structured.heartbeatDecisions).toHaveLength(0);
  });

  it("stops pending automatic heartbeat work when disposed", async () => {
    vi.useFakeTimers();
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-heartbeat-dispose-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    process.env.MONO_CONFIG_DIR = await createAgentConfig(rootDir);

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const agent = new Agent({ cwd });
    await agent.initialize();
    agent.dispose();

    await vi.advanceTimersByTimeAsync(35_000);

    const structured = await agent.inspectStructuredMemory();
    expect(structured.heartbeatDecisions).toHaveLength(0);
  });

  it("still runs manual heartbeat work when automatic heartbeat is disabled", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-heartbeat-manual-disabled-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    process.env.MONO_CONFIG_DIR = await createAgentConfig(rootDir);

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const agent = new Agent({ cwd, heartbeatEnabled: false });
    await agent.initialize();

    const heartbeat = await agent.runHeartbeatOnce();
    const structured = await agent.inspectStructuredMemory();

    expect(heartbeat.decision?.decision).toBe("noop");
    expect(heartbeat.triggeredIntent).toBeUndefined();
    expect(structured.heartbeatDecisions.length).toBeGreaterThan(0);
    expect(structured.heartbeatDecisions[0]?.decision).toBe("noop");
  });

  it("runs a curiosity heartbeat in curiosity mode and writes back one question and hypothesis", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-curiosity-heartbeat-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    process.env.MONO_CONFIG_DIR = await createAgentConfig(rootDir);

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const agent = new Agent({ cwd });
    await agent.initialize();

    const internal = agent as unknown as {
      state: {
        structuredMemoryStore: {
          upsertSelfRuntime: (patch: unknown) => Promise<void>;
        };
      };
      runTaskDetailed: (goal: string, options?: unknown) => Promise<{
        result: TaskResult;
        heartbeatReplyEvaluation?: {
          status: "ack" | "duplicate" | "sent" | "suppressed";
          rawText: string;
          normalizedText: string;
          visibleText: string;
          reason: string;
        };
      }>;
    };

    await internal.state.structuredMemoryStore.upsertSelfRuntime({
      openQuestions: [],
      currentHypotheses: ["The idle runtime may need a lightweight curiosity pass."],
      taskHints: ["Look for one repo question worth exploring."],
      currentGoals: ["Understand the heartbeat curiosity behavior."],
      currentTensions: ["The runtime keeps idling without synthesizing new questions."],
    });

    let optionsSeen: {
      interactionMode?: string;
      sandboxMode?: string;
      lease?: { maxWallTimeMs: number; maxToolCalls: number; maxSteps: number };
    } | undefined;
    const originalRunTaskDetailed = internal.runTaskDetailed.bind(agent);
    internal.runTaskDetailed = async (_goal, options) => {
      optionsSeen = options as {
        interactionMode?: string;
        sandboxMode?: string;
        lease?: { maxWallTimeMs: number; maxToolCalls: number; maxSteps: number };
      };
      return {
        result: {
          taskId: "curiosity-task",
          status: "done",
          summary: "Curiosity probe completed.",
          turns: 1,
          verification: { mode: "none", evidence: [], passed: true },
          messages: [
            {
              role: "assistant",
              provider: "openai",
              model: "gpt-4.1-mini",
              stopReason: "stop",
              timestamp: Date.now(),
              content: [{
                type: "text",
                text: [
                  "Light scan complete.",
                  "[curiosity-question: Why does the heartbeat never synthesize a follow-up repo question from recent tensions?]",
                  "[curiosity-hypothesis: The runtime only records tensions directly and lacks a curiosity probe to turn them into open questions.]",
                  "[curiosity-evidence: Current structured runtime contains tensions and hints, but openQuestions remains empty.]",
                ].join("\n"),
              }],
            },
          ],
        },
        heartbeatReplyEvaluation: {
          status: "sent",
          rawText: "raw",
          normalizedText: "normalized",
          visibleText: [
            "Light scan complete.",
            "[curiosity-question: Why does the heartbeat never synthesize a follow-up repo question from recent tensions?]",
            "[curiosity-hypothesis: The runtime only records tensions directly and lacks a curiosity probe to turn them into open questions.]",
            "[curiosity-evidence: Current structured runtime contains tensions and hints, but openQuestions remains empty.]",
          ].join("\n"),
          reason: "reply-sent",
        },
      };
    };

    try {
      const heartbeat = await agent.runHeartbeatOnce();
      const structured = await agent.inspectStructuredMemory();

      expect(heartbeat.triggeredIntent?.kind).toBe("curiosity_probe");
      expect(optionsSeen?.interactionMode).toBe("curiosity");
      expect(optionsSeen?.lease).toMatchObject({
        maxWallTimeMs: 20_000,
        maxToolCalls: 2,
        maxSteps: 3,
      });
      expect(structured.selfRuntime.openQuestions.some((item) => item.includes("synthesize a follow-up repo question"))).toBe(true);
      expect(structured.selfRuntime.currentHypotheses.some((item) => item.includes("lacks a curiosity probe"))).toBe(true);
      expect(structured.selfRuntime.cooldowns.some((item) => item.key === "curiosity:global")).toBe(true);
    } finally {
      internal.runTaskDetailed = originalRunTaskDetailed;
    }
  });

  it("does not append duplicate blocked autonomy intents for repeated confirmation-only heartbeat candidates", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-heartbeat-dedupe-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    process.env.MONO_CONFIG_DIR = await createAgentConfig(rootDir);

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const agent = new Agent({ cwd });
    await agent.initialize();

    const internal = agent as unknown as {
      state: {
        session: { sessionId: string; getHeadId: () => string | undefined };
        structuredMemoryStore: {
          upsertSelfRuntime: (patch: unknown) => Promise<void>;
        };
        taskTodoStore: {
          upsert: (record: ReturnType<typeof createTaskTodoRecord>) => Promise<void>;
        };
      };
    };

    await internal.state.structuredMemoryStore.upsertSelfRuntime({
      autonomyPolicy: {
        enabled: true,
        heartbeatIntervalMs: 30_000,
        maxAutonomousTasksPerHour: 6,
        allowBroadExecution: false,
      },
    });
    await internal.state.taskTodoStore.upsert(createTaskTodoRecord({
      taskId: "task-blocked",
      goal: "Fix the failing test",
      sessionId: internal.state.session.sessionId,
      branchHeadId: internal.state.session.getHeadId(),
      cwd,
      verificationMode: "strict",
      todos: [{ id: "todo-1", description: "Inspect the failing test", status: "in_progress" }],
      status: "blocked",
    }));

    await agent.runHeartbeatOnce();
    await agent.runHeartbeatOnce();

    const structured = await agent.inspectStructuredMemory();
    expect(structured.autonomyQueue).toHaveLength(1);
    expect(structured.autonomyQueue[0]?.status).toBe("blocked");

    delete process.env.MONO_CONFIG_DIR;
  });

  it("counts recent blocked autonomy intents against the hourly cap", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-heartbeat-cap-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    process.env.MONO_CONFIG_DIR = await createAgentConfig(rootDir);

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const agent = new Agent({ cwd });
    await agent.initialize();

    const internal = agent as unknown as {
      state: {
        session: { sessionId: string; getHeadId: () => string | undefined };
        structuredMemoryStore: {
          upsertSelfRuntime: (patch: unknown) => Promise<void>;
          appendAutonomyIntent: (record: {
            createdAt: number;
            kind: "resume_task";
            sourceSignal: "stalled_task";
            priority: number;
            riskLevel: "low";
            recommendedAction: "resume_task";
            status: "blocked";
            goal: string;
            evidence: string[];
          }) => Promise<void>;
        };
        taskTodoStore: {
          upsert: (record: ReturnType<typeof createTaskTodoRecord>) => Promise<void>;
        };
      };
      runTaskDetailed: (goal: string, options?: unknown) => Promise<unknown>;
    };

    await internal.state.structuredMemoryStore.upsertSelfRuntime({
      autonomyPolicy: {
        enabled: true,
        heartbeatIntervalMs: 30_000,
        maxAutonomousTasksPerHour: 1,
        allowBroadExecution: true,
      },
    });
    await internal.state.structuredMemoryStore.appendAutonomyIntent({
      createdAt: Date.now() - 5_000,
      kind: "resume_task",
      sourceSignal: "stalled_task",
      priority: 1,
      riskLevel: "low",
      recommendedAction: "resume_task",
      status: "blocked",
      goal: "Previous blocked heartbeat task",
      evidence: ["blocked once"],
    });
    await internal.state.taskTodoStore.upsert(createTaskTodoRecord({
      taskId: "task-cap",
      goal: "Fix the newest failing test",
      sessionId: internal.state.session.sessionId,
      branchHeadId: internal.state.session.getHeadId(),
      cwd,
      verificationMode: "strict",
      todos: [{ id: "todo-1", description: "Inspect the failing test", status: "in_progress" }],
      status: "blocked",
    }));

    let runTaskCalls = 0;
    const originalRunTaskDetailed = internal.runTaskDetailed.bind(agent);
    internal.runTaskDetailed = async (...args) => {
      runTaskCalls += 1;
      return originalRunTaskDetailed(...args);
    };

    try {
      const heartbeat = await agent.runHeartbeatOnce();
      const structured = await agent.inspectStructuredMemory();
      expect(heartbeat.decision?.decision).toBe("noop");
      expect(structured.heartbeatDecisions[0]?.reasons).toContain("Autonomy hourly cap reached.");
      expect(heartbeat.triggeredIntent).toBeUndefined();
      expect(runTaskCalls).toBe(0);
    } finally {
      internal.runTaskDetailed = originalRunTaskDetailed;
      delete process.env.MONO_CONFIG_DIR;
    }
  });

  it("runs autonomous heartbeat tasks in an isolated session and restores the main session afterwards", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-heartbeat-isolated-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    process.env.MONO_CONFIG_DIR = await createAgentConfig(rootDir);

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const agent = new Agent({ cwd });
    await agent.initialize();

    const internal = agent as unknown as {
      state: {
        session: { sessionId: string; getHeadId: () => string | undefined };
        structuredMemoryStore: {
          upsertSelfRuntime: (patch: unknown) => Promise<void>;
        };
        taskTodoStore: {
          upsert: (record: ReturnType<typeof createTaskTodoRecord>) => Promise<void>;
        };
      };
      runTaskDetailed: (goal: string, options?: unknown) => Promise<{
        result: {
          taskId?: string;
          status: "done";
          summary: string;
          turns: number;
          verification: { mode: "none"; evidence: string[]; passed: true };
          messages: [];
        };
        heartbeatReplyEvaluation?: {
          status: "ack" | "duplicate" | "sent" | "suppressed";
          rawText: string;
          normalizedText: string;
          visibleText: string;
          reason: string;
        };
      }>;
    };

    const mainSessionId = internal.state.session.sessionId;
    await internal.state.structuredMemoryStore.upsertSelfRuntime({
      autonomyPolicy: {
        enabled: true,
        heartbeatIntervalMs: 30_000,
        maxAutonomousTasksPerHour: 6,
        allowBroadExecution: true,
        isolatedSession: true,
      },
    });
    await internal.state.taskTodoStore.upsert(createTaskTodoRecord({
      taskId: "task-isolated",
      goal: "Fix the failing test",
      sessionId: internal.state.session.sessionId,
      branchHeadId: internal.state.session.getHeadId(),
      cwd,
      verificationMode: "strict",
      todos: [{ id: "todo-1", description: "Inspect the failing test", status: "in_progress" }],
      status: "blocked",
    }));

    let sessionIdSeenInsideRun: string | undefined;
    let isolatedFilePath: string | undefined;
    const originalRunTaskDetailed = internal.runTaskDetailed.bind(agent);
    internal.runTaskDetailed = async (_goal: string) => {
      sessionIdSeenInsideRun = internal.state.session.sessionId;
      isolatedFilePath = internal.state.session.filePath;
      return {
        result: {
          taskId: "heartbeat-task",
          status: "done",
          summary: "done",
          turns: 1,
          verification: { mode: "none", evidence: [], passed: true },
          messages: [
            {
              role: "assistant",
              provider: "openai",
              model: "gpt-4.1-mini",
              stopReason: "stop",
              timestamp: Date.now(),
              content: [{ type: "text", text: "HEARTBEAT_OK" }],
            },
          ],
        },
        heartbeatReplyEvaluation: {
          status: "ack",
          rawText: "HEARTBEAT_OK",
          normalizedText: "HEARTBEAT_OK",
          visibleText: "",
          reason: "heartbeat-ack",
        },
      };
    };

    try {
      await agent.runHeartbeatOnce();
    } finally {
      internal.runTaskDetailed = originalRunTaskDetailed;
    }

    expect(sessionIdSeenInsideRun).toBeDefined();
    expect(sessionIdSeenInsideRun).not.toBe(mainSessionId);
    expect(agent.getSessionId()).toBe(mainSessionId);
    expect(isolatedFilePath).toBeDefined();
    await expect(stat(isolatedFilePath!)).rejects.toThrow();

    delete process.env.MONO_CONFIG_DIR;
  });

  it("auto-allows paired Telegram DM senders without inheriting that bypass to groups", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-telegram-pairing-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    const configDir = await createAgentConfig(rootDir, {
      channels: {
        telegram: {
          enabled: false,
          botToken: undefined,
          botId: undefined,
          allowFrom: [],
          groupAllowFrom: [],
          groups: {},
          approval: {
            allowChats: [],
            commandDenylist: ["pnpm publish"],
          },
          dmPolicy: "pairing",
          pollingTimeoutSeconds: 20,
        },
      },
    });
    await mkdir(join(configDir, "state", "telegram"), { recursive: true });
    await writeFile(
      join(configDir, "state", "telegram", "allowFrom.json"),
      JSON.stringify({ version: 1, allowFrom: ["7001"] }),
      "utf8",
    );
    process.env.MONO_CONFIG_DIR = configDir;

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const agent = new Agent({ cwd });
    await agent.initialize();

    const policy = await (agent as unknown as {
      createPermissionPolicy: (channel: { platform: string; kind: "dm" | "channel"; id: string }) => Promise<{
        evaluate: (request: {
          toolName: string;
          input: unknown;
          cwd: string;
          sessionId: string;
          channel?: { platform: string; kind: "dm" | "channel"; id: string };
        }) => { type: string; reason?: string };
      }>;
    }).createPermissionPolicy({
      platform: "telegram",
      kind: "dm",
      id: "7001",
    });

    expect(policy.evaluate({
      toolName: "bash",
      input: { command: "pwd" },
      cwd,
      sessionId: "session-1",
      channel: { platform: "telegram", kind: "dm", id: "7001" },
    })).toEqual({ type: "allow" });
    expect(policy.evaluate({
      toolName: "bash",
      input: { command: "pnpm publish --tag next" },
      cwd,
      sessionId: "session-1",
      channel: { platform: "telegram", kind: "dm", id: "7001" },
    })).toEqual({
      type: "ask",
      reason: "Command matches configured denylist",
    });

    const groupPolicy = await (agent as unknown as {
      createPermissionPolicy: (channel: { platform: string; kind: "dm" | "channel"; id: string }) => Promise<{
        evaluate: (request: {
          toolName: string;
          input: unknown;
          cwd: string;
          sessionId: string;
          channel?: { platform: string; kind: "dm" | "channel"; id: string };
        }) => { type: string; reason?: string };
      }>;
    }).createPermissionPolicy({
      platform: "telegram",
      kind: "channel",
      id: "-1007001",
    });

    expect(groupPolicy.evaluate({
      toolName: "bash",
      input: { command: "pwd" },
      cwd,
      sessionId: "session-1",
      channel: { platform: "telegram", kind: "channel", id: "-1007001" },
    })).toEqual({ type: "allow" });

    delete process.env.MONO_CONFIG_DIR;
  });

  it("auto-allows Telegram DMs from config allowFrom in allowlist mode", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-telegram-allowlist-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    process.env.MONO_CONFIG_DIR = await createAgentConfig(rootDir, {
      channels: {
        telegram: {
          enabled: false,
          botToken: undefined,
          botId: undefined,
          allowFrom: ["7002"],
          groupAllowFrom: [],
          groups: {},
          approval: {
            allowChats: [],
            commandDenylist: [],
          },
          dmPolicy: "allowlist",
          pollingTimeoutSeconds: 20,
        },
      },
    });

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const agent = new Agent({ cwd });
    await agent.initialize();

    const policy = await (agent as unknown as {
      createPermissionPolicy: (channel: { platform: string; kind: "dm" | "channel"; id: string }) => Promise<{
        evaluate: (request: {
          toolName: string;
          input: unknown;
          cwd: string;
          sessionId: string;
          channel?: { platform: string; kind: "dm" | "channel"; id: string };
        }) => { type: string; reason?: string };
      }>;
    }).createPermissionPolicy({
      platform: "telegram",
      kind: "dm",
      id: "7002",
    });

    expect(policy.evaluate({
      toolName: "write",
      input: { path: "README.md", content: "hello" },
      cwd,
      sessionId: "session-1",
      channel: { platform: "telegram", kind: "dm", id: "7002" },
    })).toEqual({ type: "allow" });

    delete process.env.MONO_CONFIG_DIR;
  });

  it("adds explicit Telegram sticker reply instructions for DM runs", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-telegram-sticker-instructions-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    process.env.MONO_CONFIG_DIR = await createAgentConfig(rootDir, {
      channels: {
        telegram: {
          enabled: false,
          botToken: undefined,
          botId: undefined,
          allowFrom: ["7002"],
          groupAllowFrom: [],
          groups: {},
          approval: {
            allowChats: [],
            commandDenylist: [],
          },
          reply: {
            multiMessage: true,
            splitDelayMs: 800,
            stickers: {
              enabled: true,
              storePath: ".mono/telegram/stickers.json",
            },
          },
          dmPolicy: "allowlist",
          pollingTimeoutSeconds: 20,
        },
      },
    });

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const agent = new Agent({ cwd });
    await agent.initialize();
    agent.setChannelCapabilityProvider({
      supportsChannel: (channel) => channel?.platform === "telegram",
      listAvailableActions: () => ["send", "sticker"],
      listStoreResources: () => ["sticker_source"],
      buildContext: async () => ({
        channel: "telegram",
        actions: ["send", "sticker"],
        storeResources: ["sticker_source"],
        recommendedAction: {
          action: "sticker",
          targetId: "7002",
          payload: {
            fileId: "CAAC123",
          },
        },
        store: {
          resource: "sticker_source",
          path: ".mono/telegram/stickers.json",
          exists: false,
          readable: true,
          entryCount: 0,
        },
      }),
      executeAction: async () => ({
        ok: true,
        channel: "telegram",
        action: "send",
        targetId: "7002",
      }),
      executeStore: async () => ({
        ok: true,
        channel: "telegram",
        resource: "sticker_source",
        action: "list",
        entryCount: 0,
      }),
    });

    const instructions = (agent as unknown as {
      buildChannelReplyInstructions: (context: {
        channel: string;
        actions: string[];
        storeResources: string[];
        currentResource?: { kind: string; available: boolean; attributes?: Record<string, string> };
        store?: { resource: string; exists: boolean; readable: boolean; entryCount: number; searchSupported?: boolean };
      }) => string;
    }).buildChannelReplyInstructions({
      channel: "telegram",
      actions: ["send", "sticker"],
      storeResources: ["sticker_source"],
      currentResource: {
        kind: "sticker",
        available: true,
        attributes: {
          fileId: "CAAC123",
          setName: "CatsPack",
        },
      },
      recommendedAction: {
        action: "sticker",
        targetId: "7002",
        payload: {
          fileId: "CAAC123",
        },
      },
      store: {
        resource: "sticker_source",
        exists: false,
        readable: true,
        entryCount: 0,
        searchSupported: true,
      },
    });

    expect(instructions).toContain("channel_action tool");
    expect(instructions).toContain("channel_store tool");
    expect(instructions).toContain("RecommendedChannelAction: sticker targeting 7002.");
    expect(instructions).toContain("RecommendedChannelActionPayload: payload.fileId=\"CAAC123\".");
    expect(instructions).toContain("Missing durable store for sticker_source does not block sending the current-turn resource now.");
    expect(instructions).toContain('action="search"');
    expect(instructions).toContain('excludeFileId: "CAAC123"');
    expect(instructions).toContain("sticker_source");

    delete process.env.MONO_CONFIG_DIR;
  });

  it("renders channel reply format rules when the channel context provides them", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-channel-format-rules-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    process.env.MONO_CONFIG_DIR = await createAgentConfig(rootDir);

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const agent = new Agent({ cwd });
    await agent.initialize();

    const rules = (agent as unknown as {
      buildChannelReplyFormattingRules: (context: {
        channel: string;
        actions: string[];
        storeResources: string[];
        replyFormattingRules?: string[];
      } | null) => string;
    }).buildChannelReplyFormattingRules({
      channel: "telegram",
      actions: ["send"],
      storeResources: [],
      replyFormattingRules: [
        "Write the final user-visible reply in plain text or Markdown, not raw HTML.",
        "Do not output HTML tags such as <b> or <pre>.",
      ],
    });

    expect(rules).toContain("Channel Reply Format Rules:");
    expect(rules).toContain("plain text or Markdown");
    expect(rules).toContain("Do not output HTML tags");
    expect((agent as unknown as {
      buildChannelReplyFormattingRules: (context: null) => string;
    }).buildChannelReplyFormattingRules(null)).toBe("");

    delete process.env.MONO_CONFIG_DIR;
  });

  it("builds structured Telegram sticker context for the current turn", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-telegram-sticker-context-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    process.env.MONO_CONFIG_DIR = await createAgentConfig(rootDir, {
      channels: {
        telegram: {
          enabled: false,
          botToken: undefined,
          botId: undefined,
          allowFrom: ["7002"],
          groupAllowFrom: [],
          groups: {},
          actions: {
            send: true,
            sticker: true,
            edit: true,
            delete: true,
            react: true,
          },
          approval: {
            allowChats: [],
            commandDenylist: [],
          },
          reply: {
            multiMessage: true,
            splitDelayMs: 800,
            stickers: {
              enabled: true,
              storePath: ".mono/telegram/stickers.json",
            },
          },
          dmPolicy: "allowlist",
          pollingTimeoutSeconds: 20,
        },
      },
    });

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const agent = new Agent({ cwd });
    await agent.initialize();
    agent.setChannelCapabilityProvider({
      supportsChannel: (channel) => channel?.platform === "telegram",
      listAvailableActions: () => ["send", "sticker"],
      listStoreResources: () => ["sticker_source"],
      buildContext: async () => ({
        channel: "telegram",
        actions: ["send", "sticker"],
        storeResources: ["sticker_source"],
        currentResource: {
          kind: "sticker",
          available: true,
          attributes: {
            fileId: "CAAC123",
            fileUniqueId: "unique-1",
            emoji: "🙂",
            setName: "CatsPack",
          },
        },
        store: {
          resource: "sticker_source",
          path: ".mono/telegram/stickers.json",
          exists: false,
          readable: true,
          entryCount: 0,
        },
      }),
      executeAction: async () => ({
        ok: true,
        channel: "telegram",
        action: "sticker",
        targetId: "7002",
      }),
      executeStore: async () => ({
        ok: true,
        channel: "telegram",
        resource: "sticker_source",
        action: "list",
        entryCount: 0,
      }),
    });

    const contextText = (agent as unknown as {
      buildChannelPlatformContext: (context: {
        channel: string;
        actions: string[];
        storeResources: string[];
        currentResource?: { kind: string; available: boolean; source?: "current_input" | "recent_history"; attributes?: Record<string, string> };
      requiredAction?: {
        required: boolean;
        action?: string;
        reason?: string;
        textOnlyFallbackAllowed: boolean;
      };
      store?: { resource: string; path?: string; exists: boolean; readable: boolean; entryCount: number; searchSupported?: boolean };
    }) => string;
    }).buildChannelPlatformContext({
      channel: "telegram",
      actions: ["send", "sticker"],
      storeResources: ["sticker_source"],
      currentResource: {
        kind: "sticker",
        available: true,
        source: "recent_history",
        attributes: {
          fileId: "CAAC123",
          fileUniqueId: "unique-1",
          emoji: "🙂",
          setName: "CatsPack",
        },
      },
      recommendedAction: {
        action: "sticker",
        targetId: "7002",
        payload: {
          fileId: "CAAC123",
        },
      },
      requiredAction: {
        required: true,
        action: "sticker",
        reason: "recent_history_reference",
        textOnlyFallbackAllowed: false,
      },
      store: {
        resource: "sticker_source",
        path: ".mono/telegram/stickers.json",
        exists: false,
        readable: true,
        entryCount: 0,
        searchSupported: true,
      },
    });

    expect(contextText).toContain("AvailableChannelActions: send, sticker");
    expect(contextText).toContain("Store.resource: sticker_source");
    expect(contextText).toContain("Store.searchSupported: yes");
    expect(contextText).toContain("CurrentTurnNativeResourceAvailable: yes");
    expect(contextText).toContain("CurrentTurnNativeResourceSource: recent_history");
    expect(contextText).toContain("Resource.fileId: CAAC123");
    expect(contextText).toContain("RequiredChannelAction.required: yes");
    expect(contextText).toContain("RequiredChannelAction.reason: recent_history_reference");
    expect(contextText).toContain("RecommendedChannelAction.action: sticker");
    expect(contextText).toContain("RecommendedChannelAction.payload.fileId: CAAC123");

    delete process.env.MONO_CONFIG_DIR;
  });

  it("injects channel tools and allowlisted bash for Telegram channel-chat runs", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-telegram-tool-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    process.env.MONO_CONFIG_DIR = await createAgentConfig(rootDir, {
      channels: {
        telegram: {
          enabled: false,
          botToken: undefined,
          botId: undefined,
          allowFrom: ["7002"],
          groupAllowFrom: [],
          groups: {},
          approval: {
            allowChats: ["7002"],
            commandDenylist: [],
          },
          reply: {
            multiMessage: true,
            splitDelayMs: 800,
            stickers: {
              enabled: true,
              storePath: ".mono/telegram/stickers.json",
            },
          },
          dmPolicy: "allowlist",
          pollingTimeoutSeconds: 20,
        },
      },
    });

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const agent = new Agent({ cwd });
    await agent.initialize();
    agent.setChannelCapabilityProvider({
      supportsChannel: (channel) => channel?.platform === "telegram",
      listAvailableActions: () => ["send", "sticker"],
      listStoreResources: () => ["sticker_source"],
      buildContext: async () => ({
        channel: "telegram",
        actions: ["send", "sticker"],
        storeResources: ["sticker_source"],
      }),
      executeAction: async () => ({
        ok: true,
        channel: "telegram",
        action: "send",
        targetId: "7002",
      }),
      executeStore: async () => ({
        ok: true,
        channel: "telegram",
        resource: "sticker_source",
        action: "list",
        entryCount: 0,
      }),
    });

    const internal = agent as unknown as {
      state: { session: unknown; model: unknown };
      createToolsForRun: (context: unknown, task: unknown) => Promise<Array<{ name: string; description: string }>>;
    };
    const baseContext = {
      runId: 1,
      controller: new AbortController(),
      session: internal.state.session,
      model: internal.state.model,
      sandboxMode: "danger-full-access",
      approvalPolicy: "on-request",
    };
    const task = {
      taskId: "task-1",
      goal: "reply in telegram",
      phase: "execute",
      attempts: 0,
      verification: {
        mode: "none",
        evidence: [],
      },
    };

    const telegramTools = await internal.createToolsForRun({
      ...baseContext,
      interactionMode: "channel_chat",
      channel: { platform: "telegram", kind: "dm", id: "7002" },
      channelContext: {
        channel: "telegram",
        actions: ["send", "sticker"],
        storeResources: ["sticker_source"],
        recommendedAction: {
          action: "sticker",
          targetId: "7002",
          payload: {
            fileId: "CAAC123",
          },
        },
      },
    }, task);
    const curiosityTools = await internal.createToolsForRun({
      ...baseContext,
      interactionMode: "curiosity",
      sandboxMode: "read-only",
    }, task);
    const nonAllowlistedTelegramTools = await internal.createToolsForRun({
      ...baseContext,
      interactionMode: "channel_chat",
      channel: { platform: "telegram", kind: "dm", id: "7003" },
      channelContext: {
        channel: "telegram",
        actions: ["send", "sticker"],
        storeResources: ["sticker_source"],
      },
    }, task);
    const localTools = await internal.createToolsForRun(baseContext, task);
    const channelActionTool = telegramTools.find((tool) => tool.name === "channel_action");

    expect(telegramTools.some((tool) => tool.name === "channel_action")).toBe(true);
    expect(telegramTools.some((tool) => tool.name === "channel_store")).toBe(true);
    expect(telegramTools.some((tool) => tool.name === "write_todos")).toBe(false);
    expect(telegramTools.some((tool) => tool.name === "read")).toBe(false);
    expect(telegramTools.some((tool) => tool.name === "write")).toBe(false);
    expect(telegramTools.some((tool) => tool.name === "edit")).toBe(false);
    expect(telegramTools.some((tool) => tool.name === "bash")).toBe(true);
    expect(curiosityTools.some((tool) => tool.name === "read")).toBe(true);
    expect(curiosityTools.some((tool) => tool.name === "bash")).toBe(true);
    expect(curiosityTools.some((tool) => tool.name === "write_todos")).toBe(false);
    expect(curiosityTools.some((tool) => tool.name === "write")).toBe(false);
    expect(curiosityTools.some((tool) => tool.name === "edit")).toBe(false);
    expect(curiosityTools.some((tool) => tool.name === "channel_action")).toBe(false);
    expect(nonAllowlistedTelegramTools.some((tool) => tool.name === "bash")).toBe(false);
    expect(channelActionTool?.description).toContain("Available actions for this run: send, sticker.");
    expect(channelActionTool?.description).toContain("payload.fileId=\"CAAC123\"");
    expect(localTools.some((tool) => tool.name === "channel_action")).toBe(false);
    expect(localTools.some((tool) => tool.name === "channel_store")).toBe(false);

    delete process.env.MONO_CONFIG_DIR;
  });

  it("uses a channel-chat task context that does not instruct todo planning", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-channel-chat-context-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    process.env.MONO_CONFIG_DIR = await createAgentConfig(rootDir);

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const agent = new Agent({ cwd });
    await agent.initialize();

    const contextText = (agent as unknown as {
      buildTaskContextForRun: (
        task: {
          goal: string;
          phase: string;
          attempts: number;
          verification: { mode: "none" | "light" | "strict"; passed?: boolean; reason?: string };
        },
        todoRecord: null,
        interactionMode: "default" | "channel_chat" | "curiosity",
      ) => string;
    }).buildTaskContextForRun({
      goal: "把这个sticker发我",
      phase: "execute",
      attempts: 0,
      verification: {
        mode: "none",
      },
    }, null, "channel_chat");

    expect(contextText).toContain("Mode: channel_chat");
    expect(contextText).toContain("Do not plan engineering work or use write_todos.");
    expect(contextText).toContain("If bash is available in this chat");
    expect(contextText).toContain("[final-reply]...[/final-reply]");
    expect(contextText).not.toContain("Use write_todos to create or update the current task plan when needed.");

    delete process.env.MONO_CONFIG_DIR;
  });

  it("uses a curiosity task context that requires tagged curiosity output", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-curiosity-context-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    process.env.MONO_CONFIG_DIR = await createAgentConfig(rootDir);

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const agent = new Agent({ cwd });
    await agent.initialize();

    const contextText = (agent as unknown as {
      buildTaskContextForRun: (
        task: {
          goal: string;
          phase: string;
          attempts: number;
          verification: { mode: "none" | "light" | "strict"; passed?: boolean; reason?: string };
        },
        todoRecord: null,
        interactionMode: "default" | "channel_chat" | "curiosity",
      ) => string;
    }).buildTaskContextForRun({
      goal: "Explore one background question suggested by recent runtime context.",
      phase: "execute",
      attempts: 0,
      verification: {
        mode: "none",
      },
    }, null, "curiosity");

    expect(contextText).toContain("Mode: curiosity");
    expect(contextText).toContain("Scan the available background context lightly and gather only read-only evidence.");
    expect(contextText).toContain("Do not edit files or use write_todos.");
    expect(contextText).toContain("[curiosity-question: ...]");
  });

  it("marks the task incomplete when a required native channel action was not satisfied", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-native-action-status-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    process.env.MONO_CONFIG_DIR = await createAgentConfig(rootDir);

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const agent = new Agent({ cwd });
    await agent.initialize();

    const result = (agent as unknown as {
      createTaskResult: (
        task: {
          taskId: string;
          goal: string;
          phase: string;
          attempts: number;
          verification: { mode: "none" | "light" | "strict"; evidence: string[]; passed?: boolean };
        },
        messages: Array<{
          role: "assistant";
          provider: string;
          model: string;
          stopReason: "stop";
          timestamp: number;
          content: Array<{ type: "text"; text: string }>;
        }>,
        loopDetected: boolean,
        leaseExceeded: boolean,
        channelActionRequirement?: {
          nativeActionRequired: boolean;
          action?: string;
          textOnlyFallbackAllowed: boolean;
        },
      ) => { status: string; channelDelivery?: { satisfied: boolean } };
    }).createTaskResult({
      taskId: "task-1",
      goal: "use sticker, not text",
      phase: "execute",
      attempts: 1,
      verification: {
        mode: "none",
        evidence: [],
      },
    }, [{
      role: "assistant",
      provider: "openai",
      model: "gpt-5.4",
      stopReason: "stop",
      timestamp: 1,
      content: [{ type: "text", text: "I can't send stickers." }],
    }], false, false, {
      nativeActionRequired: true,
      action: "sticker",
      textOnlyFallbackAllowed: false,
    });

    expect(result.status).toBe("incomplete");
    expect(result.channelDelivery?.satisfied).toBe(false);

    delete process.env.MONO_CONFIG_DIR;
  });

  it("does not infer channel_action send from ordinary text prompts", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("packages/agent-core/src/agent.ts", "utf8");

    expect(source).toContain('context.actions.filter((action) => action.toLowerCase() !== "send")');
  });

  it("does not infer native sticker actions without an available current resource", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("packages/agent-core/src/agent.ts", "utf8");

    expect(source).toContain("if (!context.currentResource?.available || !currentKind || !searchableActions.includes(currentKind))");
    expect(source).not.toContain('searchableActions.find((action) => text.includes(action.toLowerCase())) ?? null');
  });

  it("keeps failed channel_action tool results from satisfying required delivery", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-native-action-fail-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    process.env.MONO_CONFIG_DIR = await createAgentConfig(rootDir);

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const agent = new Agent({ cwd });
    await agent.initialize();

    const result = (agent as unknown as {
      createTaskResult: (
        task: {
          taskId: string;
          goal: string;
          phase: string;
          attempts: number;
          verification: { mode: "none" | "light" | "strict"; evidence: string[]; passed?: boolean };
        },
        messages: Array<unknown>,
        loopDetected: boolean,
        leaseExceeded: boolean,
        channelActionRequirement?: {
          nativeActionRequired: boolean;
          action?: string;
          textOnlyFallbackAllowed: boolean;
        },
      ) => { status: string; channelDelivery?: { satisfied: boolean } };
    }).createTaskResult({
      taskId: "task-2",
      goal: "use sticker",
      phase: "execute",
      attempts: 1,
      verification: {
        mode: "none",
        evidence: [],
      },
    }, [{
      role: "tool",
      toolCallId: "tool-1",
      toolName: "channel_action",
      input: { action: "sticker" },
      content: JSON.stringify({ ok: false, action: "sticker", reason: "disabled" }),
      isError: false,
      timestamp: Date.now(),
    }], false, false, {
      nativeActionRequired: true,
      action: "sticker",
      textOnlyFallbackAllowed: false,
    });

    expect(result.status).toBe("incomplete");
    expect(result.channelDelivery?.satisfied).toBe(false);

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

  it("hides non-user currentTask and todo state from foreground getters", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-foreground-task-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    process.env.MONO_CONFIG_DIR = await createAgentConfig(rootDir);

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const agent = new Agent({ cwd });
    await agent.initialize();

    (agent as unknown as {
      state: {
        currentTask?: TaskState;
        currentTodoRecord?: ReturnType<typeof createTaskTodoRecord>;
      };
    }).state.currentTask = {
      taskId: "heartbeat-task",
      goal: "background curiosity",
      phase: "blocked",
      attempts: 1,
      origin: "heartbeat",
      verification: { mode: "none", evidence: [] },
    };
    (agent as unknown as {
      state: {
        currentTodoRecord?: ReturnType<typeof createTaskTodoRecord>;
      };
    }).state.currentTodoRecord = createTaskTodoRecord({
      taskId: "heartbeat-task",
      goal: "background curiosity",
      sessionId: "session-1",
      cwd,
      verificationMode: "none",
      todos: [{ id: "probe", description: "probe repo", status: "in_progress" }],
    });

    expect(agent.getCurrentTask()).toBeUndefined();
    expect(agent.getCurrentTodoRecord()).toBeUndefined();

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

  it("can switch to a shared session without replacing the current model", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-preserve-model-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    const configDir = await createAgentConfig(rootDir);
    process.env.MONO_CONFIG_DIR = configDir;

    await writeFile(
      join(configDir, "config.json"),
      JSON.stringify({
        version: 1,
        mono: {
          defaultProfile: "telegram-shared",
          profiles: {
            "telegram-shared": {
              provider: "openai",
              modelId: "MiniMax-M2.7-highspeed",
              baseURL: "https://api.minimaxi.com/v1",
              family: "openai-compatible",
              transport: "openai-compatible",
              providerFactory: "custom",
              apiKeyRef: "local:telegram-shared",
              supportsTools: true,
              supportsReasoning: true,
              supportsAttachments: true,
            },
          },
        },
      }),
      "utf8",
    );

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const { SessionManager } = await import("../packages/session/src/index.js");
    const agent = new Agent({ cwd, profile: "telegram-shared" });
    await agent.initialize();

    const currentSession = agent.getSessionId();
    const otherSession = new SessionManager({
      cwd,
      sessionsDir: SessionManager.rootDirFromSessionFile((agent as unknown as { state: { session: { filePath: string } } }).state.session.filePath),
      sessionId: "telegram-shared-session",
    });
    await otherSession.initialize({
      provider: "openai",
      modelId: "gpt-5.4",
      family: "openai-compatible",
      baseURL: "https://api.openai.com/v1",
      supportsTools: true,
      supportsReasoning: true,
    } as never);

    expect(agent.getCurrentModel().modelId).toBe("MiniMax-M2.7-highspeed");

    await agent.switchSession(otherSession.sessionId, undefined, { preserveCurrentModel: true });

    expect(agent.getSessionId()).toBe(otherSession.sessionId);
    expect(agent.getCurrentModel().modelId).toBe("MiniMax-M2.7-highspeed");
    expect(agent.getSessionId()).not.toBe(currentSession);

    delete process.env.MONO_CONFIG_DIR;
  });

  it("lists configured profiles with resolved model metadata", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-profiles-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    process.env.MONO_CONFIG_DIR = await createAgentConfig(rootDir);

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const agent = new Agent({ cwd });

    const profiles = await agent.listConfiguredProfiles();

    const testProfile = createTestProfileConfig();
    expect(profiles).toEqual([
      expect.objectContaining({
        name: "default",
        model: expect.objectContaining({
          provider: testProfile.provider,
          modelId: testProfile.modelId
        })
      })
    ]);

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

  it("lists models and can switch model before initialization even if the default profile is invalid", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    const configDir = join(rootDir, ".mono");
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, "config.json"),
      JSON.stringify({
        version: 1,
        mono: {
          defaultProfile: "broken",
          profiles: {
            broken: {
              provider: "unsupported",
              modelId: "unsupported-model",
              baseURL: "https://unsupported.example/v1",
              family: "anthropic",
              transport: "xsai-unsupported",
              supportsTools: true,
              supportsReasoning: true
            }
          },
          memory: {
            enabled: true,
            autoInject: true,
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
    process.env.MONO_CONFIG_DIR = configDir;

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const agent = new Agent({ cwd });

    const models = await agent.listModels();
    expect(models.some((model) => model.provider === "openai" && model.modelId === "gpt-4.1-mini")).toBe(true);

    const selected = await agent.setModel("openai/gpt-4.1-mini");
    expect(selected.provider).toBe("openai");
    expect(selected.modelId).toBe("gpt-4.1-mini");
    expect(agent.getCurrentModel().provider).toBe("openai");

    delete process.env.MONO_CONFIG_DIR;
  });

  it("reports whether a model override is active", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    process.env.MONO_CONFIG_DIR = await createAgentConfig(rootDir);

    const { Agent } = await import("../packages/agent-core/src/agent.js");

    const defaultAgent = new Agent({ cwd });
    expect(defaultAgent.hasModelSelectionOverride()).toBe(false);

    const overriddenAgent = new Agent({ cwd, model: "openai/gpt-4.1-mini" });
    expect(overriddenAgent.hasModelSelectionOverride()).toBe(true);

    delete process.env.MONO_CONFIG_DIR;
  });

  it("clears the model override when switching to a profile", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-profile-switch-"));
    const cwd = join(rootDir, "workspace");
    const configDir = join(rootDir, ".mono");
    await mkdir(cwd, { recursive: true });
    await mkdir(join(configDir, "local"), { recursive: true });
    await writeFile(
      join(configDir, "config.json"),
      JSON.stringify({
        version: 1,
        mono: {
          defaultProfile: "default",
          profiles: {
            default: {
              ...createTestProfileConfig(),
              apiKeyRef: "local:default",
            },
            telegram: {
              provider: "anthropic",
              modelId: "claude-sonnet-4-5",
              baseURL: "https://api.anthropic.com/v1",
              family: "anthropic",
              transport: "anthropic",
              apiKeyRef: "local:telegram",
              supportsTools: true,
              supportsReasoning: true,
            },
          },
        },
      }),
      "utf8"
    );
    await writeFile(
      join(configDir, "local", "secrets.json"),
      JSON.stringify({
        version: 1,
        profiles: {
          default: { apiKey: "openai-key" },
          telegram: { apiKey: "anthropic-key" },
        },
      }),
      "utf8"
    );
    process.env.MONO_CONFIG_DIR = configDir;
    const originalMonoApiKey = process.env.MONO_API_KEY;
    delete process.env.MONO_API_KEY;

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const agent = new Agent({ cwd });

    try {
      await agent.setModel(getTestModelSelectionString());
      expect(agent.hasModelSelectionOverride()).toBe(true);

      const resolved = await agent.setProfile("telegram");
      expect(agent.hasModelSelectionOverride()).toBe(false);
      expect(resolved.profileName).toBe("telegram");
      expect(resolved.model.provider).toBe("anthropic");
      expect(resolved.apiKey).toBe("anthropic-key");
    } finally {
      if (originalMonoApiKey === undefined) {
        delete process.env.MONO_API_KEY;
      } else {
        process.env.MONO_API_KEY = originalMonoApiKey;
      }
    }

    delete process.env.MONO_CONFIG_DIR;
  });
});
