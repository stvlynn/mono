import type { MemoryRecord } from "@mono/shared";

export const EXECUTION_MEMORY_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS execution_memories (
    id VARCHAR(191) PRIMARY KEY,
    project_key VARCHAR(191) NOT NULL,
    session_id VARCHAR(191) NULL,
    branch_head_id VARCHAR(191) NULL,
    created_at BIGINT NOT NULL,
    parents_json LONGTEXT NOT NULL,
    children_json LONGTEXT NOT NULL,
    referenced_memory_ids_json LONGTEXT NOT NULL,
    input_text LONGTEXT NOT NULL,
    output_text LONGTEXT NOT NULL,
    compacted_text LONGTEXT NOT NULL,
    tags_json LONGTEXT NOT NULL,
    files_json LONGTEXT NOT NULL,
    tools_json LONGTEXT NOT NULL,
    detailed_json LONGTEXT NOT NULL,
    record_json LONGTEXT NOT NULL
  )`
];

export const SESSION_MIRROR_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS session_entries (
    entry_id VARCHAR(191) PRIMARY KEY,
    session_id VARCHAR(191) NOT NULL,
    cwd_slug VARCHAR(191) NOT NULL,
    parent_id VARCHAR(191) NULL,
    entry_type VARCHAR(64) NOT NULL,
    entry_timestamp BIGINT NOT NULL,
    payload_json LONGTEXT NOT NULL,
    entry_json LONGTEXT NOT NULL
  )`
];

export function sqlString(value: string | undefined | null): string {
  if (value === undefined || value === null) {
    return "NULL";
  }
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

export function sqlNumber(value: number | undefined | null): string {
  if (value === undefined || value === null) {
    return "NULL";
  }
  return Number.isFinite(value) ? String(value) : "NULL";
}

export function sqlJson(value: unknown): string {
  return sqlString(JSON.stringify(value));
}

export function buildExecutionMemoryUpsert(record: MemoryRecord): string {
  const compactedText = record.compacted.join("\n");
  return `
    INSERT INTO execution_memories (
      id, project_key, session_id, branch_head_id, created_at,
      parents_json, children_json, referenced_memory_ids_json,
      input_text, output_text, compacted_text,
      tags_json, files_json, tools_json, detailed_json, record_json
    ) VALUES (
      ${sqlString(record.id)},
      ${sqlString(record.projectKey)},
      ${sqlString(record.sessionId)},
      ${sqlString(record.branchHeadId)},
      ${sqlNumber(record.createdAt)},
      ${sqlJson(record.parents)},
      ${sqlJson(record.children)},
      ${sqlJson(record.referencedMemoryIds)},
      ${sqlString(record.input)},
      ${sqlString(record.output)},
      ${sqlString(compactedText)},
      ${sqlJson(record.tags)},
      ${sqlJson(record.files)},
      ${sqlJson(record.tools)},
      ${sqlJson(record.detailed)},
      ${sqlJson(record)}
    )
    ON DUPLICATE KEY UPDATE
      project_key = VALUES(project_key),
      session_id = VALUES(session_id),
      branch_head_id = VALUES(branch_head_id),
      created_at = VALUES(created_at),
      parents_json = VALUES(parents_json),
      children_json = VALUES(children_json),
      referenced_memory_ids_json = VALUES(referenced_memory_ids_json),
      input_text = VALUES(input_text),
      output_text = VALUES(output_text),
      compacted_text = VALUES(compacted_text),
      tags_json = VALUES(tags_json),
      files_json = VALUES(files_json),
      tools_json = VALUES(tools_json),
      detailed_json = VALUES(detailed_json),
      record_json = VALUES(record_json)
  `.trim();
}

export function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}
