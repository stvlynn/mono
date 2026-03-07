import { describe, expect, it, vi } from "vitest";
import type { ConversationMessage, MemoryRecord } from "../packages/shared/src/index.js";
import { OpenVikingHttpClient } from "../packages/openviking-adapter/src/client.js";
import { OpenVikingRetrievalProvider } from "../packages/openviking-adapter/src/retrieval.js";
import { OpenVikingShadowExporter } from "../packages/openviking-adapter/src/shadow-export.js";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {})
    }
  });
}

describe("OpenViking HTTP client", () => {
  it("sends auth and agent headers on health checks", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        ok: true
      })
    );
    const client = new OpenVikingHttpClient({
      url: "https://openviking.example",
      apiKey: "test-key",
      agentId: "mono-agent",
      fetchImpl
    });

    await client.health();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://openviking.example/health");
    expect(init?.headers).toMatchObject({
      "X-API-Key": "test-key",
      "X-OpenViking-Agent": "mono-agent"
    });
  });
});

describe("OpenViking retrieval provider", () => {
  it("renders retrieved context for direct query recall", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const url = String(_url);
      if (url.endsWith("/api/v1/search/find")) {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          query: "how does memory work?",
          target_uri: "viking://agent/memories/"
        });
        return jsonResponse({
          status: "ok",
          result: {
            memories: [
              {
                uri: "viking://memory/one",
                abstract: "Execution memory about session compression.",
                score: 0.91
              }
            ],
            resources: [],
            skills: [],
            total: 1
          }
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const provider = new OpenVikingRetrievalProvider({
      config: {
        enabled: true,
        url: "https://openviking.example",
        apiKeyEnv: "OPENVIKING_API_KEY",
        agentId: "mono",
        timeoutMs: 30_000,
        targetUri: "viking://agent/memories/",
        useSessionSearch: true,
        shadowExport: false
      },
      fetchImpl
    });

    const result = await provider.recallForQuery({
      query: "how does memory work?"
    });

    expect(result.source).toBe("openviking");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.uri).toBe("viking://memory/one");
    expect(result.contextBlock).toContain("<MemoryContext source=\"openviking\">");
    expect(result.contextBlock).toContain("Execution memory about session compression.");
  });

  it("syncs recent messages into an ephemeral OpenViking session for session recall", async () => {
    const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const url = String(_url);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method: init?.method, body });

      if (url.endsWith("/api/v1/sessions")) {
        return jsonResponse({
          status: "ok",
          result: {
            session_id: "ov-session-1"
          }
        });
      }

      if (url.endsWith("/api/v1/sessions/ov-session-1/messages")) {
        return jsonResponse({
          status: "ok"
        });
      }

      if (url.endsWith("/api/v1/search/search")) {
        return jsonResponse({
          status: "ok",
          result: {
            memories: [
              {
                uri: "viking://memory/two",
                abstract: "Recent session context",
                score: 0.87
              }
            ],
            resources: [
              {
                uri: "viking://resource/readme",
                abstract: "README resource",
                score: 0.55
              }
            ],
            skills: [],
            total: 2
          }
        });
      }

      if (url.endsWith("/api/v1/sessions/ov-session-1") && init?.method === "DELETE") {
        return jsonResponse({
          status: "ok"
        });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const provider = new OpenVikingRetrievalProvider({
      config: {
        enabled: true,
        url: "https://openviking.example",
        apiKeyEnv: "OPENVIKING_API_KEY",
        agentId: "mono",
        timeoutMs: 30_000,
        targetUri: "viking://agent/memories/",
        useSessionSearch: true,
        shadowExport: false
      },
      fetchImpl
    });

    const messages: ConversationMessage[] = [
      { role: "user", content: "inspect README", timestamp: 1 },
      {
        role: "assistant",
        provider: "openai",
        model: "gpt-4.1-mini",
        stopReason: "tool_use",
        timestamp: 2,
        content: [{ type: "text", text: "Reading the repo layout." }]
      }
    ];

    const result = await provider.recallForSession({
      sessionId: "mono-session-1",
      messages,
      query: "readme architecture"
    });

    expect(result.items).toHaveLength(2);
    expect(result.contextBlock).toContain("viking://memory/two");
    expect(result.contextBlock).toContain("viking://resource/readme");

    const messageBodies = calls
      .filter((call) => call.url.endsWith("/api/v1/sessions/ov-session-1/messages"))
      .map((call) => call.body);
    expect(messageBodies).toEqual([
      { role: "user", content: "inspect README" },
      { role: "assistant", content: "Reading the repo layout." }
    ]);
    expect(calls.some((call) => call.url.endsWith("/api/v1/search/search"))).toBe(true);
    expect(calls.some((call) => call.url.endsWith("/api/v1/sessions/ov-session-1") && call.method === "DELETE")).toBe(true);
  });
});

describe("OpenViking shadow exporter", () => {
  it("exports a local memory record through session extraction", async () => {
    const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const url = String(_url);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method: init?.method, body });

      if (url.endsWith("/api/v1/sessions")) {
        return jsonResponse({
          status: "ok",
          result: {
            session_id: "ov-shadow-1"
          }
        });
      }

      if (url.endsWith("/api/v1/sessions/ov-shadow-1/messages")) {
        return jsonResponse({ status: "ok" });
      }

      if (url.endsWith("/api/v1/sessions/ov-shadow-1/extract")) {
        return jsonResponse({
          status: "ok",
          result: {
            extracted: 3
          }
        });
      }

      if (url.endsWith("/api/v1/sessions/ov-shadow-1") && init?.method === "DELETE") {
        return jsonResponse({ status: "ok" });
      }

      throw new Error(`Unexpected URL: ${url}`);
    });

    const exporter = new OpenVikingShadowExporter({
      config: {
        enabled: true,
        url: "https://openviking.example",
        apiKeyEnv: "OPENVIKING_API_KEY",
        agentId: "mono",
        timeoutMs: 30_000,
        targetUri: "viking://agent/memories/",
        useSessionSearch: true,
        shadowExport: true
      },
      fetchImpl
    });

    const record: MemoryRecord = {
      id: "mem-1",
      createdAt: Date.now(),
      projectKey: "project",
      sessionId: "mono-session",
      branchHeadId: "branch-a",
      parents: [],
      children: [],
      referencedMemoryIds: [],
      input: "inspect package.json",
      compacted: ["Read package.json", "Found scripts"],
      output: "Summarized package metadata.",
      detailed: [{ type: "user", text: "inspect package.json" }],
      tags: [],
      files: ["package.json"],
      tools: ["read"]
    };

    const result = await exporter.exportRecord(record);

    expect(result.recordId).toBe("mem-1");
    expect(result.sessionId).toBe("ov-shadow-1");
    expect(result.extracted).toEqual({ extracted: 3 });

    const postedBodies = calls
      .filter((call) => call.url.endsWith("/api/v1/sessions/ov-shadow-1/messages"))
      .map((call) => call.body);
    expect(postedBodies[0]).toEqual({
      role: "user",
      content: "inspect package.json"
    });
    expect(postedBodies[1]).toEqual({
      role: "assistant",
      content: expect.stringContaining("Execution summary:")
    });
    expect(calls.some((call) => call.url.endsWith("/api/v1/sessions/ov-shadow-1/extract"))).toBe(true);
    expect(calls.some((call) => call.url.endsWith("/api/v1/sessions/ov-shadow-1") && call.method === "DELETE")).toBe(true);
  });
});
