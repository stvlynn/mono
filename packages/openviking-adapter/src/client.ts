import type { OpenVikingConnectionOptions, OpenVikingMatchedContext, OpenVikingSearchResult } from "./types.js";

interface ApiEnvelope<T> {
  status: "ok" | "error";
  result?: T;
  error?: {
    code?: string;
    message?: string;
  };
}

export class OpenVikingHttpClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenVikingConnectionOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async health(): Promise<unknown> {
    const response = await this.fetchImpl(this.resolveUrl("/health"), {
      method: "GET",
      headers: this.buildHeaders(false),
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000)
    });
    if (!response.ok) {
      throw new Error(`OpenViking health check failed: ${response.status} ${await response.text()}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return response.json();
    }
    return response.text();
  }

  async createSession(): Promise<string> {
    const result = await this.request<{ session_id: string }>("/api/v1/sessions", {
      method: "POST"
    });
    return result.session_id;
  }

  async addMessage(sessionId: string, role: "user" | "assistant", content: string): Promise<void> {
    await this.request(`/api/v1/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: "POST",
      body: {
        role,
        content
      }
    });
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.request(`/api/v1/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE"
    });
  }

  async extractSession(sessionId: string): Promise<unknown> {
    return this.request(`/api/v1/sessions/${encodeURIComponent(sessionId)}/extract`, {
      method: "POST"
    });
  }

  async find(query: string, options: { targetUri: string; limit?: number }): Promise<OpenVikingSearchResult> {
    return this.request<OpenVikingSearchResult>("/api/v1/search/find", {
      method: "POST",
      body: {
        query,
        target_uri: options.targetUri,
        limit: options.limit ?? 10
      }
    }).then(normalizeSearchResult);
  }

  async search(query: string, options: { targetUri: string; sessionId?: string; limit?: number }): Promise<OpenVikingSearchResult> {
    return this.request<OpenVikingSearchResult>("/api/v1/search/search", {
      method: "POST",
      body: {
        query,
        target_uri: options.targetUri,
        session_id: options.sessionId,
        limit: options.limit ?? 10
      }
    }).then(normalizeSearchResult);
  }

  private async request<T>(path: string, options: { method: string; body?: unknown }): Promise<T> {
    const response = await this.fetchImpl(this.resolveUrl(path), {
      method: options.method,
      headers: this.buildHeaders(Boolean(options.body)),
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000)
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`OpenViking request failed: ${response.status} ${text}`);
    }
    const payload = text ? (JSON.parse(text) as ApiEnvelope<T>) : undefined;
    if (payload?.status === "error") {
      throw new Error(payload.error?.message ?? "OpenViking request returned an error");
    }
    return (payload?.result ?? undefined) as T;
  }

  private buildHeaders(includeJsonBody: boolean): Record<string, string> {
    const headers: Record<string, string> = {};
    if (includeJsonBody) {
      headers["Content-Type"] = "application/json";
    }
    if (this.options.apiKey) {
      headers["X-API-Key"] = this.options.apiKey;
    }
    if (this.options.agentId) {
      headers["X-OpenViking-Agent"] = this.options.agentId;
    }
    return headers;
  }

  private resolveUrl(path: string): string {
    return new URL(path, this.options.url.endsWith("/") ? this.options.url : `${this.options.url}/`).toString();
  }
}

function normalizeSearchResult(result: OpenVikingSearchResult): OpenVikingSearchResult {
  return {
    memories: normalizeMatches(result.memories, "memory"),
    resources: normalizeMatches(result.resources, "resource"),
    skills: normalizeMatches(result.skills, "skill"),
    total: result.total ?? 0,
    queryPlan: result.queryPlan
  };
}

function normalizeMatches(
  items: OpenVikingSearchResult["memories"] | undefined,
  fallbackType: OpenVikingMatchedContext["contextType"]
): OpenVikingMatchedContext[] {
  return (items ?? []).map((item) => ({
    ...item,
    contextType: item.contextType ?? fallbackType,
    abstract: item.abstract ?? "",
    uri: item.uri
  }));
}
