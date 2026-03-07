import { describe, expect, it } from "vitest";
import type { MemoryRecord, SessionEntry } from "../packages/shared/src/index.js";
import type { SeekDbRunner } from "../packages/seekdb-adapter/src/types.js";
import { SeekDbExecutionMemoryBackend } from "../packages/seekdb-adapter/src/execution-memory.js";
import { SeekDbRetrievalProvider } from "../packages/seekdb-adapter/src/retrieval.js";
import { SeekDbSessionMirror } from "../packages/seekdb-adapter/src/session-mirror.js";

class FakeSeekDbRunner implements SeekDbRunner {
  readonly memoryRecords = new Map<string, MemoryRecord>();
  readonly sessionEntries = new Map<string, { sessionId: string; entry: SessionEntry }>();

  async health(): Promise<unknown> {
    return { ok: true };
  }

  async execute(statements: string[]): Promise<void> {
    for (const statement of statements) {
      if (statement.includes("INSERT INTO execution_memories")) {
        const record = JSON.parse(decodeSqlString(extractValue(statement, "record_json"))) as MemoryRecord;
        this.memoryRecords.set(record.id, record);
        continue;
      }

      if (statement.includes("INSERT INTO session_entries")) {
        const sessionId = decodeSqlString(extractValue(statement, "session_id"));
        const entry = JSON.parse(decodeSqlString(extractValue(statement, "entry_json"))) as SessionEntry;
        this.sessionEntries.set(entry.id, { sessionId, entry });
      }
    }
  }

  async queryRows(sql: string): Promise<string[]> {
    if (sql.includes("AS payload FROM execution_memories") && sql.includes("COUNT(*)")) {
      const sessionId = extractWhereValue(sql, "session_id");
      return [String(this.filterMemoryRecords(sessionId).length)];
    }

    if (sql.includes("SELECT id AS payload FROM execution_memories")) {
      const sessionId = extractWhereValue(sql, "session_id");
      const limit = extractLimit(sql);
      return this.filterMemoryRecords(sessionId)
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, limit)
        .map((record) => record.id);
    }

    if (sql.includes("SELECT record_json AS payload FROM execution_memories WHERE id =")) {
      const id = extractWhereValue(sql, "id");
      const record = id ? this.memoryRecords.get(id) : undefined;
      return record ? [JSON.stringify(record)] : [];
    }

    if (sql.includes("SELECT record_json AS payload FROM execution_memories WHERE id IN")) {
      const ids = extractInValues(sql);
      return ids
        .map((id) => this.memoryRecords.get(id))
        .filter((record): record is MemoryRecord => record !== undefined)
        .map((record) => JSON.stringify(record));
    }

    if (sql.includes("SELECT record_json AS payload FROM execution_memories") && sql.includes("LIKE")) {
      const sessionId = extractWhereValue(sql, "session_id");
      const query = extractLikeFragment(sql);
      const limit = extractLimit(sql);
      return this.filterMemoryRecords(sessionId)
        .filter((record) =>
          [record.input, record.output, ...record.compacted].some((line) => line.toLowerCase().includes(query.toLowerCase()))
        )
        .sort((left, right) => right.createdAt - left.createdAt)
        .slice(0, limit)
        .map((record) => JSON.stringify(record));
    }

    if (sql.includes("AS payload FROM session_entries") && sql.includes("COUNT(*)")) {
      const sessionId = extractWhereValue(sql, "session_id");
      return [String(this.filterSessionEntries(sessionId).length)];
    }

    if (sql.includes("SELECT entry_json AS payload FROM session_entries")) {
      const sessionId = extractWhereValue(sql, "session_id");
      const query = extractLikeFragment(sql);
      const limit = extractLimit(sql);
      return this.filterSessionEntries(sessionId)
        .filter((item) => JSON.stringify(item.entry).toLowerCase().includes(query.toLowerCase()))
        .sort((left, right) => right.entry.timestamp - left.entry.timestamp)
        .slice(0, limit)
        .map((item) => JSON.stringify(item.entry));
    }

    return [];
  }

  private filterMemoryRecords(sessionId?: string): MemoryRecord[] {
    return [...this.memoryRecords.values()].filter((record) => !sessionId || record.sessionId === sessionId);
  }

  private filterSessionEntries(sessionId?: string): Array<{ sessionId: string; entry: SessionEntry }> {
    if (!sessionId) {
      return [...this.sessionEntries.values()];
    }
    return [...this.sessionEntries.values()].filter((item) => item.sessionId === sessionId);
  }
}

describe("SeekDB execution-memory backend", () => {
  it("stores and retrieves execution memory records through the runner abstraction", async () => {
    const runner = new FakeSeekDbRunner();
    const backend = new SeekDbExecutionMemoryBackend({
      config: {
        enabled: true,
        mode: "mysql",
        timeoutMs: 30_000,
        mysqlBinary: "mysql",
        database: "mono_eval",
        mirrorSessionsOnly: true
      },
      runner
    });

    const first = createMemoryRecord({
      id: "mem-1",
      createdAt: 1,
      sessionId: "session-a",
      input: "inspect README",
      output: "Summarized the README",
      compacted: ["Read README", "Summarized package layout"]
    });
    const second = createMemoryRecord({
      id: "mem-2",
      createdAt: 2,
      sessionId: "session-a",
      input: "inspect prompts",
      output: "Checked prompt templates",
      compacted: ["Read prompt templates", "Confirmed waiting copy template"]
    });

    await backend.append(first);
    await backend.append(second);

    expect(await backend.count()).toBe(2);
    expect(await backend.getLatest({ sessionId: "session-a", limit: 2 })).toEqual(["mem-2", "mem-1"]);
    expect(await backend.getById("mem-1")).toMatchObject({ id: "mem-1", input: "inspect README" });
    expect((await backend.getByIds(["mem-2", "mem-1"])).map((record) => record.id)).toEqual(["mem-2", "mem-1"]);

    const matches = await backend.searchByKeyword("prompt", { sessionId: "session-a" });
    expect(matches).toHaveLength(1);
    expect(matches[0]?.id).toBe("mem-2");
  });
});

describe("SeekDB session mirror", () => {
  it("mirrors session entries and exposes searchable summaries", async () => {
    const runner = new FakeSeekDbRunner();
    const mirror = new SeekDbSessionMirror({
      config: {
        enabled: true,
        mode: "mysql",
        timeoutMs: 30_000,
        mysqlBinary: "mysql",
        database: "mono_eval",
        mirrorSessionsOnly: true
      },
      runner
    });

    const entry: SessionEntry = {
      id: "entry-1",
      parentId: "root",
      timestamp: 123,
      entryType: "user",
      payload: {
        role: "user",
        timestamp: 123,
        content: "inspect README"
      }
    };

    const result = await mirror.mirrorSession({
      sessionId: "session-a",
      cwd: "/tmp/project",
      headId: "entry-1",
      entries: [entry]
    });

    expect(result).toMatchObject({
      sessionId: "session-a",
      mirroredEntries: 1,
      headId: "entry-1",
      mode: "mysql"
    });
    expect(await mirror.countEntries()).toBe(1);

    const matches = await mirror.searchEntries("README");
    expect(matches).toHaveLength(1);
    expect(matches[0]?.id).toBe("entry-1");
    expect(matches[0]?.summary).toContain("user");
  });
});

describe("SeekDB retrieval provider", () => {
  it("renders combined execution-memory and mirrored-session context", async () => {
    const runner = new FakeSeekDbRunner();
    const backend = new SeekDbExecutionMemoryBackend({
      config: {
        enabled: true,
        mode: "mysql",
        timeoutMs: 30_000,
        mysqlBinary: "mysql",
        database: "mono_eval",
        mirrorSessionsOnly: true
      },
      runner
    });
    const sessionMirror = new SeekDbSessionMirror({
      config: {
        enabled: true,
        mode: "mysql",
        timeoutMs: 30_000,
        mysqlBinary: "mysql",
        database: "mono_eval",
        mirrorSessionsOnly: true
      },
      runner
    });

    await backend.append(
      createMemoryRecord({
        id: "mem-42",
        createdAt: 42,
        sessionId: "session-a",
        input: "inspect memory system",
        output: "Mapped execution memory and task todo memory",
        compacted: ["Execution memory is append-only", "Task todo memory is mutable"]
      })
    );
    await sessionMirror.mirrorSession({
      sessionId: "session-a",
      cwd: "/tmp/project",
      entries: [
        {
          id: "entry-42",
          timestamp: 42,
          entryType: "assistant",
          payload: {
            role: "assistant",
            timestamp: 42,
            provider: "openai",
            model: "gpt-4.1-mini",
            stopReason: "stop",
            content: [{ type: "text", text: "Explained the memory system." }]
          }
        }
      ]
    });

    const provider = new SeekDbRetrievalProvider({
      config: {
        enabled: true,
        mode: "mysql",
        timeoutMs: 30_000,
        mysqlBinary: "mysql",
        database: "mono_eval",
        mirrorSessionsOnly: true
      },
      backend,
      sessionMirror,
      limit: 4,
      runner
    });

    const result = await provider.recallForQuery({
      query: "memory system",
      sessionId: "session-a"
    });

    expect(result.source).toBe("seekdb");
    expect(result.items.some((item) => item.id === "mem-42")).toBe(true);
    expect(result.items.some((item) => item.id === "entry-42")).toBe(true);
    expect(result.contextBlock).toContain("<MemoryContext source=\"seekdb\">");
    expect(result.contextBlock).toContain("mem-42");
    expect(result.contextBlock).toContain("entry-42");
  });
});

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

function extractValue(statement: string, columnName: string): string {
  const columnNames = statement.match(/INSERT INTO [^(]+\(([\s\S]+?)\)\s+VALUES/i)?.[1];
  const valuesSegment = statement.match(/VALUES\s*\(([\s\S]+?)\)\s*ON DUPLICATE KEY UPDATE/i)?.[1];
  if (!columnNames || !valuesSegment) {
    throw new Error(`Unable to parse statement: ${statement}`);
  }

  const columns = splitSqlList(columnNames);
  const values = splitSqlList(valuesSegment);
  const index = columns.findIndex((column) => column.trim() === columnName);
  if (index === -1) {
    throw new Error(`Column not found in statement: ${columnName}`);
  }
  return values[index]!.trim();
}

function splitSqlList(input: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inString = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    const next = input[index + 1];

    if (char === "'" && next === "'") {
      current += "''";
      index += 1;
      continue;
    }

    if (char === "'") {
      inString = !inString;
      current += char;
      continue;
    }

    if (char === "," && !inString) {
      parts.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }
  return parts;
}

function decodeSqlString(value: string): string {
  if (value === "NULL") {
    return "";
  }
  if (!value.startsWith("'") || !value.endsWith("'")) {
    return value;
  }
  return value.slice(1, -1).replace(/''/g, "'").replace(/\\\\/g, "\\");
}

function extractWhereValue(sql: string, column: string): string | undefined {
  const match = sql.match(new RegExp(`${column}\\s*=\\s*'([^']*)'`, "i"));
  return match?.[1];
}

function extractInValues(sql: string): string[] {
  const match = sql.match(/IN\s*\(([\s\S]+)\)/i);
  if (!match) {
    return [];
  }
  return splitSqlList(match[1]!).map((value) => decodeSqlString(value));
}

function extractLimit(sql: string): number {
  const match = sql.match(/LIMIT\s+(\d+)/i);
  return Number(match?.[1] ?? "10");
}

function extractLikeFragment(sql: string): string {
  const match = sql.match(/LIKE\s+'%(.+?)%'/i);
  return match?.[1]?.replace(/\\%/g, "%").replace(/\\_/g, "_").replace(/\\\\/g, "\\") ?? "";
}
