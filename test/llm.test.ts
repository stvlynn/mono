import { afterEach, describe, expect, it, vi } from "vitest";
import type { LlmRunOptions } from "../packages/llm/src/adapters/index.js";
import type { AgentTool } from "../packages/shared/src/index.js";
import { getAdapterForModel, ModelRegistry } from "../packages/llm/src/index.js";
import { conversationMessagesToModelMessages } from "../packages/llm/src/adapters/ai-sdk-runtime.js";

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

function createEventSourceStream(chunks: Array<Record<string, unknown>>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const payload = chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("");

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    }
  });
}

function createOpenAIResponsesResponse(chunks: Array<Record<string, unknown>>): Response {
  return new Response(createEventSourceStream(chunks), {
    status: 200,
    headers: {
      "content-type": "text/event-stream"
    }
  });
}

function createOpenAIResponsesTextResponse(text: string, model = "gpt-4.1-mini"): Response {
  return createOpenAIResponsesResponse([
    {
      type: "response.created",
      response: {
        id: "resp_1",
        created_at: 1,
        model
      }
    },
    {
      type: "response.output_item.added",
      output_index: 0,
      item: {
        type: "message",
        id: "msg_1"
      }
    },
    {
      type: "response.output_text.delta",
      item_id: "msg_1",
      delta: text
    },
    {
      type: "response.output_item.done",
      output_index: 0,
      item: {
        type: "message",
        id: "msg_1"
      }
    },
    {
      type: "response.completed",
      response: {
        incomplete_details: null,
        usage: {
          input_tokens: 1,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: 1,
          output_tokens_details: { reasoning_tokens: 0 }
        },
        service_tier: null
      }
    }
  ]);
}

describe("llm adapters", () => {
  it("routes anthropic models to the anthropic AI SDK adapter", async () => {
    const registry = new ModelRegistry();
    await registry.load();
    const model = registry.resolve("anthropic/claude-sonnet-4-5");
    const adapter = getAdapterForModel(model);

    expect(model.family).toBe("anthropic");
    expect(adapter.id).toBe("ai-sdk-anthropic");
  });

  it("routes openai-compatible models to the generic AI SDK adapter", async () => {
    const registry = new ModelRegistry();
    await registry.load();
    const model = registry.resolve("openai/gpt-4.1-mini");
    const adapter = getAdapterForModel(model);

    expect(adapter.id).toBe("ai-sdk-openai-compatible");
  });

  it("routes openai responses transport models to the responses adapter", () => {
    const adapter = getAdapterForModel({
      provider: "moonshotai",
      modelId: "kimi-k2-turbo-preview",
      family: "openai-compatible",
      transport: "openai-responses",
      runtimeProviderKey: "moonshotai:openai-responses",
      baseURL: "https://api.moonshot.cn/v1",
      apiKeyEnv: "MOONSHOT_API_KEY",
      providerFactory: "custom",
      supportsTools: true,
      supportsReasoning: true,
      supportsAttachments: true
    });

    expect(adapter.id).toBe("ai-sdk-openai-responses");
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

    expect(adapter.id).toBe("ai-sdk-anthropic");
  });

  it("routes gemini models to the generic google AI SDK adapter", () => {
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

    expect(adapter.id).toBe("ai-sdk-gemini");
  });

  it("adds fallback text for image-only user messages", () => {
    const modelMessages = conversationMessagesToModelMessages({
      provider: "openai",
      modelId: "gpt-4.1-mini",
      family: "openai-compatible",
      transport: "openai-compatible",
      runtimeProviderKey: "openai:openai-compatible",
      baseURL: "https://api.openai.com/v1",
      apiKey: "test-key",
      apiKeyEnv: "OPENAI_API_KEY",
      providerFactory: "openai",
      supportsTools: true,
      supportsReasoning: true,
      supportsAttachments: true
    }, [
      {
        role: "user",
        content: [
          { type: "image", mimeType: "image/webp", data: "aGVsbG8=" }
        ],
        timestamp: Date.now()
      }
    ]);

    expect(modelMessages).toEqual([{
      role: "user",
      content: [
        { type: "image", image: "aGVsbG8=", mediaType: "image/webp" },
        { type: "text", text: "User sent an image." }
      ]
    }]);
  });

  it("uses the responses endpoint for openai responses transport models", async () => {
    const fetchMock = vi.fn().mockResolvedValue(createOpenAIResponsesTextResponse("Responses API ok"));
    global.fetch = fetchMock as typeof global.fetch;

    const adapter = getAdapterForModel({
      provider: "moonshotai",
      modelId: "kimi-k2-turbo-preview",
      family: "openai-compatible",
      transport: "openai-responses",
      runtimeProviderKey: "moonshotai:openai-responses",
      baseURL: "https://api.moonshot.cn/v1",
      apiKey: "test-key",
      apiKeyEnv: "MOONSHOT_API_KEY",
      providerFactory: "custom",
      supportsTools: true,
      supportsReasoning: true,
      supportsAttachments: true
    });

    const messages = await adapter.run({
      model: {
        provider: "moonshotai",
        modelId: "kimi-k2-turbo-preview",
        family: "openai-compatible",
        transport: "openai-responses",
        runtimeProviderKey: "moonshotai:openai-responses",
        baseURL: "https://api.moonshot.cn/v1",
        apiKey: "test-key",
        apiKeyEnv: "MOONSHOT_API_KEY",
        providerFactory: "custom",
        supportsTools: true,
        supportsReasoning: true,
        supportsAttachments: true
      },
      systemPrompt: "You are a helpful assistant.",
      messages: [
        {
          role: "user",
          content: "Hello",
          timestamp: Date.now()
        }
      ],
      tools: [],
      thinkingLevel: "off",
      maxSteps: 1,
      emit() {}
    } satisfies LlmRunOptions);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.moonshot.cn/v1/responses");

    const requestBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(requestBody.model).toBe("kimi-k2-turbo-preview");
    expect(messages.at(0)).toMatchObject({
      role: "assistant",
      stopReason: "stop",
      content: [{ type: "text", text: "Responses API ok" }]
    });
  });

  it("extracts think-style wrappers into reasoning parts instead of leaking them into text", async () => {
    const fetchMock = vi.fn().mockResolvedValue(createOpenAIResponsesResponse([
      {
        type: "response.created",
        response: {
          id: "resp_2",
          created_at: 1,
          model: "MiniMax-M2.7-highspeed",
        }
      },
      {
        type: "response.output_item.added",
        output_index: 0,
        item: {
          type: "message",
          id: "msg_2"
        }
      },
      {
        type: "response.output_text.delta",
        item_id: "msg_2",
        delta: "<thi"
      },
      {
        type: "response.output_text.delta",
        item_id: "msg_2",
        delta: "nk>internal reasoning"
      },
      {
        type: "response.output_text.delta",
        item_id: "msg_2",
        delta: "</think>\n\nhel"
      },
      {
        type: "response.output_text.delta",
        item_id: "msg_2",
        delta: "lo"
      },
      {
        type: "response.output_item.done",
        output_index: 0,
        item: {
          type: "message",
          id: "msg_2"
        }
      },
      {
        type: "response.completed",
        response: {
          incomplete_details: null,
          usage: {
            input_tokens: 1,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens: 1,
            output_tokens_details: { reasoning_tokens: 0 }
          },
          service_tier: null
        }
      }
    ]));
    global.fetch = fetchMock as typeof global.fetch;

    const adapter = getAdapterForModel({
      provider: "openai",
      modelId: "MiniMax-M2.7-highspeed",
      family: "openai-compatible",
      transport: "openai-responses",
      runtimeProviderKey: "openai:openai-responses",
      baseURL: "https://api.minimaxi.com/v1",
      apiKey: "test-key",
      apiKeyEnv: "OPENAI_API_KEY",
      providerFactory: "custom",
      supportsTools: true,
      supportsReasoning: true,
      supportsAttachments: true
    });

    const events: Array<{ type: string; delta: string }> = [];
    const messages = await adapter.run({
      model: {
        provider: "openai",
        modelId: "MiniMax-M2.7-highspeed",
        family: "openai-compatible",
        transport: "openai-responses",
        runtimeProviderKey: "openai:openai-responses",
        baseURL: "https://api.minimaxi.com/v1",
        apiKey: "test-key",
        apiKeyEnv: "OPENAI_API_KEY",
        providerFactory: "custom",
        supportsTools: true,
        supportsReasoning: true,
        supportsAttachments: true
      },
      systemPrompt: "You are a helpful assistant.",
      messages: [
        {
          role: "user",
          content: "Hello",
          timestamp: Date.now()
        }
      ],
      tools: [],
      thinkingLevel: "off",
      maxSteps: 1,
      emit(event) {
        if (event.type === "assistant-text-delta" || event.type === "assistant-thinking-delta") {
          events.push({ type: event.type, delta: event.delta });
        }
      }
    } satisfies LlmRunOptions);

    expect(events.filter((event) => event.type === "assistant-text-delta").map((event) => event.delta).join("")).not.toContain("<think>");
    expect(events.filter((event) => event.type === "assistant-thinking-delta").map((event) => event.delta).join("")).toContain("internal reasoning");
    expect(messages.at(0)).toMatchObject({
      role: "assistant",
      content: [
        { type: "thinking", thinking: "internal reasoning" },
        { type: "text", text: "\n\nhello" },
      ],
    });
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

  it("preserves tool image outputs as anthropic media blocks in follow-up steps", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createAnthropicResponse([
        {
          event: "message_start",
          data: {
            type: "message_start",
            message: {
              id: "msg_tool_image",
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
              id: "toolu_img",
              name: "read_image",
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
              partial_json: "{\"path\":\"diagram.png\"}"
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
      .mockResolvedValueOnce(createAnthropicTextResponse("Image analyzed"));
    global.fetch = fetchMock as typeof global.fetch;

    const tool: AgentTool<{ path: string }> = {
      name: "read_image",
      description: "Read an image from disk",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string" }
        },
        required: ["path"],
        additionalProperties: false
      },
      parseArgs(args) {
        return args as { path: string };
      },
      async execute() {
        return {
          content: [
            { type: "text", text: "Rendered diagram" },
            { type: "image", mimeType: "image/png", data: "aGVsbG8=" }
          ]
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

    await adapter.run({
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
      systemPrompt: "You are a vision agent.",
      messages: [
        {
          role: "user",
          content: "Inspect the generated image",
          timestamp: Date.now()
        }
      ],
      tools: [tool],
      thinkingLevel: "off",
      maxSteps: 2,
      emit() {}
    } satisfies LlmRunOptions);

    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(secondBody.messages.at(-1)).toEqual({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_img",
          content: [
            { type: "text", text: "Rendered diagram" },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: "aGVsbG8="
              }
            }
          ]
        }
      ]
    });
  });

  it("surfaces the underlying provider error when the stream fails before any step completes", async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('{"error":{"message":"Invalid Authentication"}}', {
      status: 401,
      headers: {
        "content-type": "application/json"
      }
    })) as typeof global.fetch;

    const adapter = getAdapterForModel({
      provider: "anthropic",
      modelId: "claude-sonnet-4-5",
      family: "anthropic",
      transport: "anthropic",
      runtimeProviderKey: "anthropic:anthropic",
      baseURL: "https://api.anthropic.com/v1",
      apiKey: "bad-key",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      providerFactory: "anthropic",
      supportsTools: true,
      supportsReasoning: true
    });

    await expect(adapter.run({
      model: {
        provider: "anthropic",
        modelId: "claude-sonnet-4-5",
        family: "anthropic",
        transport: "anthropic",
        runtimeProviderKey: "anthropic:anthropic",
        baseURL: "https://api.anthropic.com/v1",
        apiKey: "bad-key",
        apiKeyEnv: "ANTHROPIC_API_KEY",
        providerFactory: "anthropic",
        supportsTools: true,
        supportsReasoning: true
      },
      systemPrompt: "You are a planner.",
      messages: [
        {
          role: "user",
          content: "hello",
          timestamp: Date.now()
        }
      ],
      tools: [],
      thinkingLevel: "off",
      maxSteps: 1,
      emit() {}
    } satisfies LlmRunOptions)).rejects.toThrow(/401|Invalid Authentication/u);
  });
});
