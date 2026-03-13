import type { MemoryRecord, MemorySearchMatch } from "@mono/shared";
import type { ExecutionMemoryBackend } from "@mono/memory";
import { buildExecutionMemoryUpsert, escapeLikePattern, EXECUTION_MEMORY_SCHEMA, sqlNumber, sqlString } from "./sql.js";
import { createSeekDbRunner } from "./runner-factory.js";
import type { SeekDbConnectionOptions, SeekDbRunner } from "./types.js";
import { findMatchedLines } from "./memory-search.js";

export class SeekDbExecutionMemoryBackend implements ExecutionMemoryBackend {
  private readonly runner: SeekDbRunner;
  private schemaReady?: Promise<void>;

  constructor(options: SeekDbConnectionOptions) {
    this.runner = options.runner ?? createSeekDbRunner(options.config);
  }

  async count(): Promise<number> {
    await this.ensureSchema();
    const rows = await this.runner.queryRows("SELECT CAST(COUNT(*) AS CHAR) AS payload FROM execution_memories");
    return Number(rows[0] ?? "0");
  }

  async getLatest(options?: { sessionId?: string; limit?: number; tags?: string[] }): Promise<string[]> {
    await this.ensureSchema();
    const where: string[] = [];
    if (options?.sessionId) {
      where.push(`session_id = ${sqlString(options.sessionId)}`);
    }
    if (options?.tags && options.tags.length > 0) {
      for (const tag of options.tags) {
        where.push(`tags_json LIKE ${sqlString(`%${escapeLikePattern(tag)}%`)}`);
      }
    }
    const limit = options?.limit ?? 10;
    const sql = [
      "SELECT id AS payload FROM execution_memories",
      where.length > 0 ? `WHERE ${where.join(" AND ")}` : "",
      "ORDER BY created_at DESC",
      `LIMIT ${sqlNumber(limit)}`
    ]
      .filter(Boolean)
      .join(" ");
    return this.runner.queryRows(sql);
  }

  async getById(id: string): Promise<MemoryRecord | null> {
    await this.ensureSchema();
    const rows = await this.runner.queryRows(
      `SELECT record_json AS payload FROM execution_memories WHERE id = ${sqlString(id)} LIMIT 1`
    );
    return rows[0] ? parseRecord(rows[0]) : null;
  }

  async getByIds(ids: string[]): Promise<MemoryRecord[]> {
    await this.ensureSchema();
    if (ids.length === 0) {
      return [];
    }
    const sql = `SELECT record_json AS payload FROM execution_memories WHERE id IN (${ids.map(sqlString).join(", ")})`;
    const records = (await this.runner.queryRows(sql)).map(parseRecord);
    const byId = new Map(records.map((record) => [record.id, record]));
    return ids.map((id) => byId.get(id)).filter((record): record is MemoryRecord => record !== undefined);
  }

  async getAncestors(id: string, level = 1): Promise<string[]> {
    await this.ensureSchema();
    const collected = new Set<string>();
    let frontier = [id];

    for (let depth = 0; depth < level; depth += 1) {
      const next: string[] = [];
      for (const currentId of frontier) {
        const record = await this.getById(currentId);
        if (!record) {
          continue;
        }
        for (const parentId of record.parents) {
          if (!collected.has(parentId)) {
            collected.add(parentId);
            next.push(parentId);
          }
        }
      }
      frontier = next;
      if (frontier.length === 0) {
        break;
      }
    }

    return [...collected];
  }

  async append(record: MemoryRecord): Promise<void> {
    await this.ensureSchema();
    await this.runner.execute([buildExecutionMemoryUpsert(record)]);
  }

  async searchByKeyword(query: string, options?: { limit?: number; sessionId?: string }): Promise<MemorySearchMatch[]> {
    await this.ensureSchema();
    const pattern = `%${escapeLikePattern(query.trim())}%`;
    const where = [
      `(
        input_text LIKE ${sqlString(pattern)} ESCAPE '\\'
        OR output_text LIKE ${sqlString(pattern)} ESCAPE '\\'
        OR compacted_text LIKE ${sqlString(pattern)} ESCAPE '\\'
        OR detailed_json LIKE ${sqlString(pattern)} ESCAPE '\\'
      )`
    ];
    if (options?.sessionId) {
      where.push(`session_id = ${sqlString(options.sessionId)}`);
    }
    const sql = [
      "SELECT record_json AS payload FROM execution_memories",
      `WHERE ${where.join(" AND ")}`,
      "ORDER BY created_at DESC",
      `LIMIT ${sqlNumber(options?.limit ?? 10)}`
    ].join(" ");

    return (await this.runner.queryRows(sql))
      .map(parseRecord)
      .map((record) => ({
        id: record.id,
        matchedLines: findMatchedLines(record, query)
      }))
      .filter((match) => match.matchedLines.length > 0);
  }

  private async ensureSchema(): Promise<void> {
    this.schemaReady ??= this.runner.execute(EXECUTION_MEMORY_SCHEMA);
    await this.schemaReady;
  }
}

function parseRecord(row: string): MemoryRecord {
  return JSON.parse(row) as MemoryRecord;
}
