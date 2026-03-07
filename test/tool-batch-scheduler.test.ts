import { describe, expect, it } from "vitest";
import type { AgentTool, RuntimeEvent, ToolResultPart, UnifiedModel } from "../packages/shared/src/index.js";
import type { LlmRunOptions } from "../packages/llm/src/adapters/types.js";
import { ToolBatchScheduler } from "../packages/llm/src/adapters/tool-batch-scheduler.js";

const model: UnifiedModel = {
  provider: "openai",
  modelId: "gpt-4.1-mini",
  family: "openai-compatible",
  baseURL: "https://api.openai.com/v1",
  supportsTools: true,
  supportsReasoning: true
};

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createScheduler() {
  const events: RuntimeEvent[] = [];
  const toolResultMap = new Map<
    string,
    { toolName: string; input: unknown; inputSignature: string; content: string | ToolResultPart[]; isError: boolean }
  >();
  const options: LlmRunOptions = {
    model,
    systemPrompt: "test",
    messages: [],
    tools: [],
    thinkingLevel: "medium",
    maxSteps: 1,
    emit: (event) => {
      events.push(event);
    }
  };

  return {
    scheduler: new ToolBatchScheduler({
      llmOptions: options,
      toolResultMap,
      toXsaiContent: (parts) => parts.map((part) => ({ type: part.type }))
    }),
    events,
    toolResultMap
  };
}

describe("ToolBatchScheduler", () => {
  it("runs readonly tools in parallel batches", async () => {
    const { scheduler, toolResultMap } = createScheduler();
    const first = createDeferred<void>();
    const second = createDeferred<void>();
    const order: string[] = [];

    const readTool = (label: string, waitFor: Promise<void>): AgentTool<{ path: string }> => ({
      name: `read_${label}`,
      description: "read test",
      executionMode: "parallel_readonly",
      inputSchema: { type: "object" },
      conflictKey: (args) => args.path,
      async execute(args) {
        order.push(`start:${label}:${args.path}`);
        await waitFor;
        order.push(`end:${label}:${args.path}`);
        return { content: `${label}:${args.path}` };
      }
    });

    const firstPromise = scheduler.schedule(readTool("a", first.promise), { path: "a.ts" }, "tool-1");
    const secondPromise = scheduler.schedule(readTool("b", second.promise), { path: "b.ts" }, "tool-2");

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(order).toEqual(["start:a:a.ts", "start:b:b.ts"]);

    first.resolve();
    second.resolve();

    await expect(firstPromise).resolves.toBe("a:a.ts");
    await expect(secondPromise).resolves.toBe("b:b.ts");
    expect(toolResultMap.get("tool-1")?.inputSignature).toContain("a.ts");
    expect(toolResultMap.get("tool-2")?.inputSignature).toContain("b.ts");
  });

  it("falls back to serial execution when a batch mixes readonly and mutating tools", async () => {
    const { scheduler } = createScheduler();
    const first = createDeferred<void>();
    const second = createDeferred<void>();
    const order: string[] = [];

    const readTool: AgentTool<{ path: string }> = {
      name: "read",
      description: "read",
      executionMode: "parallel_readonly",
      inputSchema: { type: "object" },
      conflictKey: (args) => args.path,
      async execute(args) {
        order.push(`start:read:${args.path}`);
        await first.promise;
        order.push(`end:read:${args.path}`);
        return { content: "read done" };
      }
    };

    const writeTool: AgentTool<{ path: string }> = {
      name: "write",
      description: "write",
      executionMode: "serial",
      inputSchema: { type: "object" },
      async execute(args) {
        order.push(`start:write:${args.path}`);
        await second.promise;
        order.push(`end:write:${args.path}`);
        return { content: "write done" };
      }
    };

    const readPromise = scheduler.schedule(readTool, { path: "README.md" }, "tool-1");
    const writePromise = scheduler.schedule(writeTool, { path: "README.md" }, "tool-2");

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(["start:read:README.md"]);

    first.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(["start:read:README.md", "end:read:README.md", "start:write:README.md"]);

    second.resolve();

    await expect(readPromise).resolves.toBe("read done");
    await expect(writePromise).resolves.toBe("write done");
  });

  it("turns parse failures into tool error results instead of crashing signature generation", async () => {
    const { scheduler, events, toolResultMap } = createScheduler();

    const readTool: AgentTool<{ path: string }> = {
      name: "read",
      description: "read",
      executionMode: "parallel_readonly",
      inputSchema: { type: "object" },
      parseArgs(input) {
        if (!input || typeof input !== "object" || typeof (input as { path?: unknown }).path !== "string") {
          throw new Error("path must be a string");
        }
        return input as { path: string };
      },
      conflictKey(args) {
        return `path=${args.path}`;
      },
      async execute() {
        return { content: "should not run" };
      }
    };

    await expect(scheduler.schedule(readTool, {}, "tool-parse-error")).resolves.toBe("path must be a string");

    expect(toolResultMap.get("tool-parse-error")).toMatchObject({
      toolName: "read",
      isError: true,
      content: "path must be a string"
    });
    expect(events.find((event) => event.type === "tool-start" && event.toolCallId === "tool-parse-error")).toBeTruthy();
    expect(events.find((event) => event.type === "tool-end" && event.toolCallId === "tool-parse-error")).toMatchObject({
      type: "tool-end",
      isError: true
    });
  });
});
