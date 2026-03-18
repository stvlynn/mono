import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTaskTodoRecord } from "../packages/agent-core/src/memory-runtime.js";
import type { MemoryRecord } from "../packages/shared/src/index.js";

async function createAgentConfig(rootDir: string, options?: { memoryEnabled?: boolean; memory?: Record<string, unknown>; channels?: Record<string, unknown> }): Promise<string> {
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
            transport: "openai-compatible",
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
        },
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

  it("injects structured memory context into inspectContext after persisting a turn", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    process.env.MONO_CONFIG_DIR = await createAgentConfig(rootDir);

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
      }
    });

    const inspected = await agent.inspectContext("直接回答");

    expect(inspected.systemPrompt).toContain("<StructuredMemoryContext");
    expect(inspected.systemPrompt).toContain("prefers_directness");

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
      type: "deny",
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
    })).toEqual({
      type: "ask",
      reason: "bash commands require confirmation by default",
    });

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

  it("injects channel_action and channel_store only for supported channel runs", async () => {
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
    const localTools = await internal.createToolsForRun(baseContext, task);
    const channelActionTool = telegramTools.find((tool) => tool.name === "channel_action");

    expect(telegramTools.some((tool) => tool.name === "channel_action")).toBe(true);
    expect(telegramTools.some((tool) => tool.name === "channel_store")).toBe(true);
    expect(telegramTools.some((tool) => tool.name === "write_todos")).toBe(false);
    expect(telegramTools.some((tool) => tool.name === "read")).toBe(false);
    expect(telegramTools.some((tool) => tool.name === "bash")).toBe(false);
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
        interactionMode: "default" | "channel_chat",
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
    expect(contextText).not.toContain("Use write_todos to create or update the current task plan when needed.");

    delete process.env.MONO_CONFIG_DIR;
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
    }], false, {
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
    }], false, {
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

  it("lists configured profiles with resolved model metadata", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-profiles-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    process.env.MONO_CONFIG_DIR = await createAgentConfig(rootDir);

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const agent = new Agent({ cwd });

    const profiles = await agent.listConfiguredProfiles();

    expect(profiles).toEqual([
      expect.objectContaining({
        name: "default",
        model: expect.objectContaining({
          provider: "openai",
          modelId: "gpt-4.1-mini"
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
              provider: "openai",
              modelId: "gpt-4.1-mini",
              baseURL: "https://api.openai.com/v1",
              family: "openai-compatible",
              transport: "openai-compatible",
              apiKeyRef: "local:default",
              supportsTools: true,
              supportsReasoning: true,
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

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const agent = new Agent({ cwd });

    await agent.setModel("openai/gpt-4.1-mini");
    expect(agent.hasModelSelectionOverride()).toBe(true);

    const resolved = await agent.setProfile("telegram");
    expect(agent.hasModelSelectionOverride()).toBe(false);
    expect(resolved.profileName).toBe("telegram");
    expect(resolved.model.provider).toBe("anthropic");
    expect(resolved.apiKey).toBe("anthropic-key");

    delete process.env.MONO_CONFIG_DIR;
  });
});
