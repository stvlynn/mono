import type { MemoryRecord } from "@mono/shared";
import { OpenVikingHttpClient } from "./client.js";
import { buildAssistantShadowText, buildStructuredAssistantShadowText } from "./shadow-text.js";
import type {
  OpenVikingRetrievalOptions,
  OpenVikingShadowExportResult,
  OpenVikingStructuredMemoryRecord,
  OpenVikingStructuredShadowExportResult
} from "./types.js";

export class OpenVikingShadowExporter {
  private readonly client: OpenVikingHttpClient;

  constructor(options: OpenVikingRetrievalOptions) {
    if (!options.config.url) {
      throw new Error("OpenViking shadow export requires a configured URL");
    }
    const apiKey = options.apiKey ?? (options.config.apiKeyEnv ? process.env[options.config.apiKeyEnv] : undefined);
    this.client = new OpenVikingHttpClient({
      url: options.config.url,
      apiKey,
      agentId: options.config.agentId,
      timeoutMs: options.config.timeoutMs,
      fetchImpl: options.fetchImpl
    });
  }

  async exportRecord(record: MemoryRecord): Promise<OpenVikingShadowExportResult> {
    const sessionId = await this.client.createSession();
    try {
      await this.client.addMessage(sessionId, "user", record.input.trim());
      await this.client.addMessage(sessionId, "assistant", buildAssistantShadowText(record));
      const extracted = await this.client.extractSession(sessionId);
      return {
        sessionId,
        extracted,
        recordId: record.id
      };
    } finally {
      await this.client.deleteSession(sessionId).catch(() => undefined);
    }
  }
}

export class OpenVikingStructuredShadowExporter {
  private readonly client: OpenVikingHttpClient;

  constructor(options: OpenVikingRetrievalOptions) {
    if (!options.config.url) {
      throw new Error("OpenViking shadow export requires a configured URL");
    }
    const apiKey = options.apiKey ?? (options.config.apiKeyEnv ? process.env[options.config.apiKeyEnv] : undefined);
    this.client = new OpenVikingHttpClient({
      url: options.config.url,
      apiKey,
      agentId: options.config.agentId,
      timeoutMs: options.config.timeoutMs,
      fetchImpl: options.fetchImpl
    });
  }

  async exportRecord(record: OpenVikingStructuredMemoryRecord): Promise<OpenVikingStructuredShadowExportResult> {
    const sessionId = await this.client.createSession();
    try {
      await this.client.addMessage(sessionId, "user", `Structured memory snapshot: ${record.id}`);
      await this.client.addMessage(sessionId, "assistant", buildStructuredAssistantShadowText(record));
      const extracted = await this.client.extractSession(sessionId);
      return {
        sessionId,
        extracted,
        recordId: record.id
      };
    } finally {
      await this.client.deleteSession(sessionId).catch(() => undefined);
    }
  }
}
