import { defaultPromptRenderer, type PromptRenderer } from "@mono/prompts";
import type { ConversationMessage } from "@mono/shared";
import type { MemoryRetrievalProvider, RetrievedContext, RetrievedContextItem } from "@mono/memory";
import type { SeekDbExecutionMemoryBackend } from "./execution-memory.js";
import type { SeekDbSessionMirror } from "./session-mirror.js";
import type { SeekDbRetrievalOptions } from "./types.js";

export class SeekDbRetrievalProvider implements MemoryRetrievalProvider {
  private readonly limit: number;

  constructor(
    private readonly options: {
      backend: SeekDbExecutionMemoryBackend;
      sessionMirror?: SeekDbSessionMirror;
      renderer?: PromptRenderer;
    } & SeekDbRetrievalOptions
  ) {
    this.limit = options.limit ?? 6;
  }

  async recallForSession(options: {
    sessionId: string;
    messages?: ConversationMessage[];
    query?: string;
  }): Promise<RetrievedContext> {
    const query = options.query?.trim() || deriveQueryFromMessages(options.messages);
    if (!query) {
      return {
        source: "seekdb",
        contextBlock: "",
        items: []
      };
    }
    return this.recallForQuery({
      query,
      sessionId: options.sessionId,
      messages: options.messages
    });
  }

  async recallForQuery(options: {
    query: string;
    sessionId?: string;
    messages?: ConversationMessage[];
  }): Promise<RetrievedContext> {
    const memoryMatches = await this.options.backend.searchByKeyword(options.query, {
      limit: this.limit,
      sessionId: options.sessionId
    });
    const memoryIds = memoryMatches.map((match) => match.id);
    const records = await this.options.backend.getByIds(memoryIds);
    const recordById = new Map(records.map((record) => [record.id, record]));
    const memoryItems = memoryMatches
      .map((match) => {
        const record = recordById.get(match.id);
        if (!record) {
          return null;
        }
        return {
          id: record.id,
          source: "seekdb" as const,
          kind: "memory" as const,
          title: record.id,
          text: match.matchedLines[0]?.text ?? record.compacted[0] ?? record.output ?? record.input
        };
      })
      .filter(
        (
          item
        ): item is {
          id: string;
          source: "seekdb";
          kind: "memory";
          title: string;
          text: string;
        } => item !== null
      );

    const sessionEntries = this.options.sessionMirror
      ? await this.options.sessionMirror.searchEntries(options.query, {
          sessionId: options.sessionId,
          limit: Math.max(2, Math.floor(this.limit / 2))
        })
      : [];

    const renderer = this.options.renderer ?? defaultPromptRenderer;
    return {
      source: "seekdb",
      contextBlock: renderer.render("memory/seekdb_context_block", {
        memories: memoryItems.map((item) => ({
          id: item.id,
          summary: item.text
        })),
        session_entries: sessionEntries
      }),
      items: [
        ...memoryItems,
        ...sessionEntries.map((entry) => ({
          id: entry.id,
          source: "seekdb" as const,
          kind: "resource" as const,
          title: entry.id,
          text: entry.summary
        }))
      ]
    };
  }
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
    if (typeof message.content === "string") {
      return message.content.trim();
    }
    return message.content
      .map((part) => ("text" in part ? part.text : ""))
      .join("\n")
      .trim();
  }
  return "";
}
