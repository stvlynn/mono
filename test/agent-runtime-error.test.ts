import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ConversationMessage, RuntimeEvent } from "../packages/shared/src/index.js";

async function createAgentConfig(rootDir: string): Promise<string> {
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
  return configDir;
}

afterEach(() => {
  delete process.env.MONO_CONFIG_DIR;
});

describe("Agent runtime error handling", () => {
  it("does not call runTaskTurn again during local verification", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-runtime-error-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    process.env.MONO_CONFIG_DIR = await createAgentConfig(rootDir);

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const agent = new Agent({ cwd });
    const events: RuntimeEvent[] = [];
    agent.subscribe((event) => {
      events.push(event);
    });
    let callCount = 0;
    (agent as unknown as {
      state: { messages: ConversationMessage[] };
      runTaskTurn: (context: { taskMessages: ConversationMessage[] }, task: { phase: string }) => Promise<ConversationMessage[]>;
    }).runTaskTurn = async (context) => {
      callCount += 1;
      if (callCount === 1) {
        const messages: ConversationMessage[] = [
          {
            role: "assistant",
            provider: "openai",
            model: "gpt-4.1-mini",
            stopReason: "stop",
            timestamp: Date.now(),
            content: [{ type: "text", text: "I fixed the build failure." }]
          },
          {
            role: "tool",
            toolCallId: "tool-1",
            toolName: "bash",
            content: "vitest passed with 0 failed and exit code 0",
            isError: false,
            timestamp: Date.now()
          }
        ];
        context.taskMessages.push(...messages);
        (agent as unknown as { state: { messages: ConversationMessage[] } }).state.messages.push(...messages);
        return messages;
      }

      throw new Error("runTaskTurn should not be called during verify");
    };

    const result = await agent.runTask("fix the build and verify it");

    expect(callCount).toBe(1);
    expect(result.status).toBe("done");
    expect(result.verification?.passed).toBe(true);
    expect(agent.getCurrentTask()?.phase).toBe("done");
    expect(events.some((event) => event.type === "task-verify-result" && event.passed)).toBe(true);
    expect(events.some((event) => event.type === "error")).toBe(false);
  });

  it("trims oversized tool results before sending them back to the model", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-runtime-error-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    process.env.MONO_CONFIG_DIR = await createAgentConfig(rootDir);

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const agent = new Agent({ cwd });
    await agent.initialize();

    const largeToolMessage: ConversationMessage = {
      role: "tool",
      toolCallId: "tool-1",
      toolName: "read",
      content: "A".repeat(3_000),
      isError: false,
      timestamp: Date.now()
    };
    const trimmed = (agent as unknown as {
      prepareMessagesForModel: (messages: ConversationMessage[]) => ConversationMessage[];
    }).prepareMessagesForModel([largeToolMessage]);

    expect(trimmed[0]).toMatchObject({
      role: "tool",
      toolName: "read",
      isError: false
    });
    expect(typeof trimmed[0]?.content).toBe("string");
    expect((trimmed[0] as Extract<ConversationMessage, { role: "tool" }>).content).toContain("[truncated");
    expect((trimmed[0] as Extract<ConversationMessage, { role: "tool" }>).content.length).toBeLessThan(1_300);
  });

  it("compacts older tool outputs once the tool budget is exhausted", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "mono-agent-runtime-error-"));
    const cwd = join(rootDir, "workspace");
    await mkdir(cwd, { recursive: true });
    process.env.MONO_CONFIG_DIR = await createAgentConfig(rootDir);

    const { Agent } = await import("../packages/agent-core/src/agent.js");
    const agent = new Agent({ cwd });
    await agent.initialize();

    const messages: ConversationMessage[] = Array.from({ length: 6 }, (_, index) => ({
      role: "tool",
      toolCallId: `tool-${index}`,
      toolName: "read",
      inputSignature: `read:path=file-${index}.ts`,
      content: `line-${index}\n${"A".repeat(2_000)}`,
      isError: false,
      timestamp: Date.now() + index
    }));

    const prepared = (agent as unknown as {
      prepareMessagesForModel: (messages: ConversationMessage[]) => ConversationMessage[];
    }).prepareMessagesForModel(messages);

    const compacted = prepared[0] as Extract<ConversationMessage, { role: "tool" }>;
    expect(typeof compacted.content).toBe("string");
    expect(compacted.content).toContain("[compact tool output]");
    expect(compacted.content).toContain("read:path=file-0.ts");

    const newest = prepared.at(-1) as Extract<ConversationMessage, { role: "tool" }>;
    expect(newest.content).toContain("[truncated");
  });
});
