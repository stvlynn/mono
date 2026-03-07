import { createHash } from "node:crypto";
import type { SessionEntry } from "@mono/shared";
import { createSeekDbRunner } from "./runner-factory.js";
import { SESSION_MIRROR_SCHEMA, sqlNumber, sqlString } from "./sql.js";
import type {
  SeekDbConnectionOptions,
  SeekDbRunner,
  SeekDbSessionMirrorInput,
  SeekDbSessionMirrorResult,
  SeekDbSessionSearchMatch
} from "./types.js";

export class SeekDbSessionMirror {
  private readonly runner: SeekDbRunner;
  private readonly mode: SeekDbSessionMirrorResult["mode"];
  private schemaReady?: Promise<void>;

  constructor(options: SeekDbConnectionOptions) {
    this.runner = options.runner ?? createSeekDbRunner(options.config);
    this.mode = options.config.mode;
  }

  async mirrorSession(input: SeekDbSessionMirrorInput): Promise<SeekDbSessionMirrorResult> {
    await this.ensureSchema();
    const slug = cwdSlug(input.cwd);
    const statements = input.entries.map((entry) => this.buildUpsertStatement(input.sessionId, slug, entry));
    if (statements.length > 0) {
      await this.runner.execute(statements);
    }
    return {
      sessionId: input.sessionId,
      mirroredEntries: input.entries.length,
      headId: input.headId,
      mode: this.mode
    };
  }

  async countEntries(sessionId?: string): Promise<number> {
    await this.ensureSchema();
    const rows = await this.runner.queryRows(
      `SELECT CAST(COUNT(*) AS CHAR) AS payload FROM session_entries${sessionId ? ` WHERE session_id = ${sqlString(sessionId)}` : ""}`
    );
    return Number(rows[0] ?? "0");
  }

  async searchEntries(query: string, options?: { sessionId?: string; limit?: number }): Promise<SeekDbSessionSearchMatch[]> {
    await this.ensureSchema();
    const pattern = `%${query.trim().replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
    const where = [
      `(payload_json LIKE ${sqlString(pattern)} ESCAPE '\\' OR entry_json LIKE ${sqlString(pattern)} ESCAPE '\\')`
    ];
    if (options?.sessionId) {
      where.push(`session_id = ${sqlString(options.sessionId)}`);
    }
    const rows = await this.runner.queryRows(
      [
        "SELECT entry_json AS payload FROM session_entries",
        `WHERE ${where.join(" AND ")}`,
        "ORDER BY entry_timestamp DESC",
        `LIMIT ${sqlNumber(options?.limit ?? 5)}`
      ].join(" ")
    );
    return rows.map((row) => {
      const entry = JSON.parse(row) as SessionEntry;
      return {
        id: entry.id,
        summary: `${entry.entryType}: ${JSON.stringify(entry.payload).slice(0, 120)}`
      };
    });
  }

  private async ensureSchema(): Promise<void> {
    this.schemaReady ??= this.runner.execute(SESSION_MIRROR_SCHEMA);
    await this.schemaReady;
  }

  private buildUpsertStatement(sessionId: string, cwdSlugValue: string, entry: SessionEntry): string {
    return `
      INSERT INTO session_entries (
        entry_id, session_id, cwd_slug, parent_id, entry_type, entry_timestamp, payload_json, entry_json
      ) VALUES (
        ${sqlString(entry.id)},
        ${sqlString(sessionId)},
        ${sqlString(cwdSlugValue)},
        ${sqlString(entry.parentId)},
        ${sqlString(entry.entryType)},
        ${sqlNumber(entry.timestamp)},
        ${sqlString(JSON.stringify(entry.payload))},
        ${sqlString(JSON.stringify(entry))}
      )
      ON DUPLICATE KEY UPDATE
        parent_id = VALUES(parent_id),
        entry_type = VALUES(entry_type),
        entry_timestamp = VALUES(entry_timestamp),
        payload_json = VALUES(payload_json),
        entry_json = VALUES(entry_json)
    `.trim();
  }
}

function cwdSlug(cwd: string): string {
  return createHash("sha1").update(cwd).digest("hex").slice(0, 12);
}
