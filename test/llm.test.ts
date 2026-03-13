import { afterEach, describe, expect, it, vi } from "vitest";
import type { LlmRunOptions } from "../packages/llm/src/adapters/index.js";
import type { AgentTool } from "../packages/shared/src/index.js";
import { getAdapterForModel, ModelRegistry } from "../packages/llm/src/index.js";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

function createAnthropicStream(events: Array<{ event: string; data: Record<string, unknown> }>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const payload = events
    .map(({ event, data }) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    .join("");

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    }
  });
}

function createAnthropicResponse(events: Array<{ event: string; data: Record<string, unknown> }>): Response {
  return new Response(createAnthropicStream(events), {
    status: 200,
    headers: {
      "content-type": "text/event-stream"
    }
  });
}

function createAnthropicTextResponse(text: string): Response {
  return createAnthropicResponse([
    {
      event: "message_start",
      data: {
        type: "message_start",
        message: {
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-5",
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 }
        }
      }
    },
    {
      event: "content_block_start",
      data: {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" }
      }
    },
    {
      event: "content_block_delta",
      data: {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text }
      }
    },
    {
      event: "content_block_stop",
      data: {
        type: "content_block_stop",
        index: 0
      }
    },
    {
      event: "message_delta",
      data: {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 1 }
      }
    },
    {
      event: "message_stop",
      data: {
        type: "message_stop"
      }
    }
  ]);
}

describe("llm adapters", () => {
  it("routes anthropic models to the anthropic xsai adapter", async () => {
    const registry = new ModelRegistry();
    await registry.load();
    const model = registry.resolve("anthropic/claude-sonnet-4-5");
    const adapter = getAdapterForModel(model);

    expect(model.family).toBe("anthropic");
    expect(adapter.id).toBe("xsai-anthropic");
  });

  it("routes openai-compatible models to the generic xsai adapter", async () => {
    const registry = new ModelRegistry();
    await registry.load();
    const model = registry.resolve("openai/gpt-4.1-mini");
    const adapter = getAdapterForModel(model);

    expect(adapter.id).toBe("xsai-openai-compatible");
  });

  it("routes anthropic-compatible runtime overrides to the anthropic adapter", () => {
    const adapter = getAdapterForModel({
      provider: "minimax",
      modelId: "MiniMax-M2.5-highspeed",
      family: "anthropic",
      transport: "anthropic",
      runtimeProviderKey: "minimax:anthropic",
      baseURL: "https://api.minimax.io/anthropic/v1",
      apiKeyEnv: "MINIMAX_API_KEY",
      providerFactory: "custom",
      supportsTools: true,
      supportsReasoning: true
    });

    expect(adapter.id).toBe("xsai-anthropic");
  });

  it("routes gemini models to the generic google xsai adapter", () => {
    const adapter = getAdapterForModel({
      provider: "google",
      modelId: "gemini-2.5-pro",
      family: "gemini",
      transport: "gemini",
      runtimeProviderKey: "google:gemini",
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
      apiKeyEnv: "GEMINI_API_KEY",
      providerFactory: "google",
      supportsTools: true,
      supportsReasoning: true
    });

    expect(adapter.id).toBe("xsai-gemini");
  });

  it("uses the anthropic messages endpoint and completes a tool loop for anthropic transport models", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createAnthropicResponse([
        {
          event: "message_start",
          data: {
            type: "message_start",
            message: {
              id: "msg_tool",
              type: "message",
              role: "assistant",
              model: "MiniMax-M2.5-highspeed",
              content: [],
              stop_reason: null,
              stop_sequence: null,
              usage: { input_tokens: 1, output_tokens: 1 }
            }
          }
        },
        {
          event: "content_block_start",
          data: {
            type: "content_block_start",
            index: 0,
            content_block: {
              type: "tool_use",
              id: "toolu_1",
              name: "write_todos",
              input: {}
            }
          }
        },
        {
          event: "content_block_delta",
          data: {
            type: "content_block_delta",
            index: 0,
            delta: {
              type: "input_json_delta",
              partial_json: "{\"todos\":[{\"id\":\"plan\",\"description\":\"Create plan\",\"status\":\"in_progress\"}]}"
            }
          }
        },
        {
          event: "content_block_stop",
          data: {
            type: "content_block_stop",
            index: 0
          }
        },
        {
          event: "message_delta",
          data: {
            type: "message_delta",
            delta: { stop_reason: "tool_use" },
            usage: { output_tokens: 1 }
          }
        },
        {
          event: "message_stop",
          data: {
            type: "message_stop"
          }
        }
      ]))
      .mockResolvedValueOnce(createAnthropicTextResponse("Plan updated"));
    global.fetch = fetchMock as typeof global.fetch;

    const tool: AgentTool<{ todos: Array<{ id: string; description: string; status: string }> }> = {
      name: "write_todos",
      description: "Persist the current plan",
      inputSchema: {
        type: "object",
        properties: {
          todos: {
            type: "array"
          }
        },
        required: ["todos"],
        additionalProperties: false
      },
      parseArgs(args) {
        return args as { todos: Array<{ id: string; description: string; status: string }> };
      },
      async execute(args) {
        return {
          content: JSON.stringify(args)
        };
      }
    };

    const adapter = getAdapterForModel({
      provider: "minimax",
      modelId: "MiniMax-M2.5-highspeed",
      family: "anthropic",
      transport: "anthropic",
      runtimeProviderKey: "minimax:anthropic",
      baseURL: "https://api.minimax.io/anthropic/v1",
      apiKey: "test-key",
      apiKeyEnv: "MINIMAX_API_KEY",
      providerFactory: "custom",
      supportsTools: true,
      supportsReasoning: true
    });

    const messages = await adapter.run({
      model: {
        provider: "minimax",
        modelId: "MiniMax-M2.5-highspeed",
        family: "anthropic",
        transport: "anthropic",
        runtimeProviderKey: "minimax:anthropic",
        baseURL: "https://api.minimax.io/anthropic/v1",
        apiKey: "test-key",
        apiKeyEnv: "MINIMAX_API_KEY",
        providerFactory: "custom",
        supportsTools: true,
        supportsReasoning: true
      },
      systemPrompt: "You are a planner.",
      messages: [
        {
          role: "user",
          content: "Create a coding plan",
          timestamp: Date.now()
        }
      ],
      tools: [tool],
      thinkingLevel: "off",
      maxSteps: 2,
      emit() {}
    } satisfies LlmRunOptions);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.minimax.io/anthropic/v1/messages");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://api.minimax.io/anthropic/v1/messages");

    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(secondBody.messages.at(-1)).toEqual({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_1",
          content: "{\"todos\":[{\"id\":\"plan\",\"description\":\"Create plan\",\"status\":\"in_progress\"}]}"
        }
      ]
    });

    expect(messages).toHaveLength(3);
    expect(messages[0]).toMatchObject({
      role: "assistant",
      stopReason: "tool_use",
      content: [
        {
          type: "tool-call",
          id: "toolu_1",
          name: "write_todos",
          arguments: {
            todos: [
              {
                id: "plan",
                description: "Create plan",
                status: "in_progress"
              }
            ]
          }
        }
      ]
    });
    expect(messages[1]).toMatchObject({
      role: "tool",
      toolCallId: "toolu_1",
      toolName: "write_todos"
    });
    expect(messages[2]).toMatchObject({
      role: "assistant",
      stopReason: "stop",
      content: [{ type: "text", text: "Plan updated" }]
    });
  });
});
