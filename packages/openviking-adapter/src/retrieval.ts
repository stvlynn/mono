import { defaultPromptRenderer } from "@mono/prompts";
import type { ConversationMessage } from "@mono/shared";
import type { MemoryRetrievalProvider, RetrievedContext, RetrievedContextItem } from "@mono/memory";
import { OpenVikingHttpClient } from "./client.js";
import type { OpenVikingMatchedContext, OpenVikingRetrievalOptions, OpenVikingSearchResult } from "./types.js";

const SESSION_SYNC_LIMIT = 12;

export class OpenVikingRetrievalProvider implements MemoryRetrievalProvider {
  private readonly client: OpenVikingHttpClient;
  private readonly targetUri: string;
  private readonly useSessionSearch: boolean;

  constructor(options: OpenVikingRetrievalOptions) {
    if (!options.config.url) {
      throw new Error("OpenViking retrieval requires a configured URL");
    }
    const apiKey = options.apiKey ?? (options.config.apiKeyEnv ? process.env[options.config.apiKeyEnv] : undefined);
    this.client = new OpenVikingHttpClient({
      url: options.config.url,
      apiKey,
      agentId: options.config.agentId,
      timeoutMs: options.config.timeoutMs,
      fetchImpl: options.fetchImpl
    });
    this.targetUri = options.config.targetUri;
    this.useSessionSearch = options.config.useSessionSearch;
  }

  async recallForSession(options: {
    sessionId: string;
    messages?: ConversationMessage[];
    query?: string;
  }): Promise<RetrievedContext> {
    const query = options.query?.trim() || deriveQueryFromMessages(options.messages);
    if (!query) {
      return {
        source: "openviking",
        contextBlock: "",
        items: []
      };
    }
    if (!this.useSessionSearch || !options.messages || options.messages.length === 0) {
      return this.recallForQuery({ query, sessionId: options.sessionId, messages: options.messages });
    }

    const sessionId = await this.syncSession(options.messages);
    try {
      const result = await this.client.search(query, {
        targetUri: this.targetUri,
        sessionId
      });
      return buildRetrievedContext(result);
    } finally {
      await this.client.deleteSession(sessionId).catch(() => undefined);
    }
  }

  async recallForQuery(options: {
    query: string;
    sessionId?: string;
    messages?: ConversationMessage[];
  }): Promise<RetrievedContext> {
    const result = await this.client.find(options.query, {
      targetUri: this.targetUri
    });
    return buildRetrievedContext(result);
  }

  async health(): Promise<unknown> {
    return this.client.health();
  }

  private async syncSession(messages: ConversationMessage[]): Promise<string> {
    const sessionId = await this.client.createSession();
    const relevantMessages = messages
      .filter((message): message is Extract<ConversationMessage, { role: "user" | "assistant" }> =>
        message.role === "user" || message.role === "assistant"
      )
      .slice(-SESSION_SYNC_LIMIT);
    for (const message of relevantMessages) {
      const text = conversationMessageToText(message);
      if (!text) {
        continue;
      }
      await this.client.addMessage(sessionId, message.role, text);
    }
    return sessionId;
  }
}

function buildRetrievedContext(result: OpenVikingSearchResult): RetrievedContext {
  const memories = result.memories.map((item) => mapItem(item, "memory"));
  const resources = result.resources.map((item) => mapItem(item, "resource"));
  const skills = result.skills.map((item) => mapItem(item, "skill"));

  return {
    source: "openviking",
    contextBlock: defaultPromptRenderer.render("memory/openviking_context_block", {
      memories: memories.map(toTemplateItem),
      resources: resources.map(toTemplateItem),
      skills: skills.map(toTemplateItem)
    }),
    items: [...memories, ...resources, ...skills]
  };
}

function mapItem(item: OpenVikingMatchedContext, kind: RetrievedContextItem["kind"]): RetrievedContextItem {
  return {
    id: item.uri,
    source: "openviking",
    kind,
    title: item.uri,
    text: item.abstract,
    uri: item.uri,
    score: item.score
  };
}

function toTemplateItem(item: RetrievedContextItem): {
  uri: string;
  abstract: string;
  reason?: string;
  score_text?: string;
} {
  return {
    uri: item.uri ?? item.id,
    abstract: item.text,
    score_text: typeof item.score === "number" ? item.score.toFixed(3) : undefined
  };
}

function conversationMessageToText(message: Extract<ConversationMessage, { role: "user" | "assistant" }>): string {
  if (message.role === "user") {
    if (typeof message.content === "string") {
      return message.content.trim();
    }
    return message.content
      .map((part) => ("text" in part ? part.text : ""))
      .join("\n")
      .trim();
  }

  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function deriveQueryFromMessages(messages: ConversationMessage[] | undefined): string {
  if (!messages) {
    return "";
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") {
      continue;
    }
    return conversationMessageToText(message);
  }
  return "";
}
