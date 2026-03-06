import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { MemoryRecord, MemorySearchMatch } from "@mono/shared";
import { ensureParentDir } from "@mono/shared";
import type { MemoryStore } from "./store.js";
import { sortMemoryRecords } from "./entities.js";

interface CoreRecord {
  id: string;
  createdAt: number;
  projectKey: string;
  sessionId?: string;
  branchHeadId?: string;
  parents: string[];
  children: string[];
  referencedMemoryIds: string[];
  compacted: string[];
  tags: string[];
  files: string[];
  tools: string[];
}

export class FolderMemoryStore implements MemoryStore {
  constructor(readonly root: string) {}

  async count(): Promise<number> {
    return (await this.listCorePaths()).length;
  }

  async getLatest(options: { sessionId?: string; limit?: number; tags?: string[] } = {}): Promise<string[]> {
    const records = await this.listRecords();
    const filtered = records.filter((record) => {
      if (options.sessionId && record.sessionId !== options.sessionId) {
        return false;
      }
      if (options.tags && options.tags.length > 0 && !options.tags.every((tag) => record.tags.includes(tag))) {
        return false;
      }
      return true;
    });
    const sorted = sortMemoryRecords(filtered).reverse().map((record) => record.id);
    return options.limit ? sorted.slice(0, options.limit) : sorted;
  }

  async getById(id: string): Promise<MemoryRecord | null> {
    const path = await this.findCorePath(id);
    if (!path) {
      return null;
    }
    return this.readRecord(path);
  }

  async getByIds(ids: string[]): Promise<MemoryRecord[]> {
    const records = await Promise.all(ids.map((id) => this.getById(id)));
    return sortMemoryRecords(records.filter((record): record is MemoryRecord => record !== null));
  }

  async getAncestors(id: string, level?: number): Promise<string[]> {
    if (level !== undefined && level < 0) {
      throw new Error(`level must be >= 0, received ${level}`);
    }
    const root = await this.getById(id);
    if (!root) {
      return [];
    }
    if (level === 0) {
      return [id];
    }

    const visited = new Set<string>();
    let frontier = [...root.parents];
    const ancestors: string[] = [];
    let depth = 0;
    while (frontier.length > 0 && (level === undefined || depth < level)) {
      depth += 1;
      const next: string[] = [];
      for (const current of frontier) {
        if (visited.has(current)) {
          continue;
        }
        visited.add(current);
        ancestors.push(current);
        const parent = await this.getById(current);
        if (parent) {
          next.push(...parent.parents);
        }
      }
      frontier = next;
    }
    return ancestors;
  }

  async append(record: MemoryRecord): Promise<void> {
    await mkdir(this.recordsDir(), { recursive: true });
    const existing = await this.findCorePath(record.id);
    if (existing) {
      throw new Error(`Duplicate memory record id: ${record.id}`);
    }

    const resolvedParents: string[] = [];
    for (const parentId of record.parents) {
      const parent = await this.getById(parentId);
      if (!parent) {
        continue;
      }
      resolvedParents.push(parentId);
      if (!parent.children.includes(record.id)) {
        parent.children = [...parent.children, record.id];
        await this.writeRecord(parent);
      }
    }

    record.parents = resolvedParents;
    await this.writeRecord(record);
  }

  async searchByKeyword(query: string, options: { limit?: number; sessionId?: string } = {}): Promise<MemorySearchMatch[]> {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return [];
    }

    const records = await this.listRecords();
    const matches: MemorySearchMatch[] = [];
    for (const record of records) {
      if (options.sessionId && record.sessionId !== options.sessionId) {
        continue;
      }

      const lines = buildSearchLines(record);
      const matchedLines = lines
        .map((text, index) => ({ line: index + 1, text }))
        .filter((item) => item.text.toLowerCase().includes(needle))
        .slice(0, options.limit ?? 6);

      if (matchedLines.length > 0) {
        matches.push({
          id: record.id,
          matchedLines
        });
      }
    }

    return matches
      .sort((a, b) => b.id.localeCompare(a.id))
      .slice(0, options.limit ?? 6);
  }

  private recordsDir(): string {
    return join(this.root, "records");
  }

  private corePathFor(record: Pick<MemoryRecord, "id" | "createdAt">): string {
    const createdAt = new Date(record.createdAt);
    return join(
      this.recordsDir(),
      `${createdAt.getUTCFullYear()}`,
      `${createdAt.getUTCMonth() + 1}`.padStart(2, "0"),
      `${createdAt.getUTCDate()}`.padStart(2, "0"),
      `${createdAt.getUTCHours()}`.padStart(2, "0"),
      `${record.id}.core.json`
    );
  }

  private detailedPathFor(record: Pick<MemoryRecord, "id" | "createdAt">): string {
    return this.corePathFor(record).replace(/\.core\.json$/, ".detailed.jsonl");
  }

  private async listCorePaths(dir = this.recordsDir()): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    const paths: string[] = [];
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        paths.push(...(await this.listCorePaths(path)));
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".core.json")) {
        paths.push(path);
      }
    }
    return paths.sort();
  }

  private async listRecords(): Promise<MemoryRecord[]> {
    const paths = await this.listCorePaths();
    const records = await Promise.all(paths.map((path) => this.readRecord(path)));
    return sortMemoryRecords(records);
  }

  private async readRecord(corePath: string): Promise<MemoryRecord> {
    const coreRaw = await readFile(corePath, "utf8");
    const core = JSON.parse(coreRaw) as CoreRecord;
    const detailedRaw = await readFile(corePath.replace(/\.core\.json$/, ".detailed.jsonl"), "utf8");
    const lines = detailedRaw.split("\n").filter(Boolean);
    const input = lines[0] ? (JSON.parse(lines[0]) as string) : "";
    const output = lines[1] ? (JSON.parse(lines[1]) as string) : "";
    const detailed = lines.slice(2).map((line) => JSON.parse(line)) as MemoryRecord["detailed"];
    return {
      ...core,
      input,
      output,
      detailed
    };
  }

  private async writeRecord(record: MemoryRecord): Promise<void> {
    const corePath = this.corePathFor(record);
    const detailedPath = this.detailedPathFor(record);
    const core: CoreRecord = {
      id: record.id,
      createdAt: record.createdAt,
      projectKey: record.projectKey,
      sessionId: record.sessionId,
      branchHeadId: record.branchHeadId,
      parents: record.parents,
      children: record.children,
      referencedMemoryIds: record.referencedMemoryIds,
      compacted: record.compacted,
      tags: record.tags,
      files: record.files,
      tools: record.tools
    };
    const detailed = [
      JSON.stringify(record.input),
      JSON.stringify(record.output),
      ...record.detailed.map((item) => JSON.stringify(item))
    ].join("\n") + "\n";

    await ensureParentDir(corePath);
    await ensureParentDir(detailedPath);
    await writeFile(detailedPath, detailed, "utf8");
    await writeFile(corePath, JSON.stringify(core, null, 2), "utf8");
  }

  private async findCorePath(id: string): Promise<string | undefined> {
    const paths = await this.listCorePaths();
    return paths.find((path) => path.endsWith(`/${id}.core.json`));
  }
}

function buildSearchLines(record: MemoryRecord): string[] {
  const lines = [record.input, record.output, ...record.compacted];
  for (const item of record.detailed) {
    if (item.type === "user") {
      lines.push(item.text);
    } else if (item.type === "assistant") {
      if (item.text) {
        lines.push(item.text);
      }
      if (item.thinking) {
        lines.push(item.thinking);
      }
    } else if (item.type === "tool_call") {
      lines.push(`${item.toolName} ${JSON.stringify(item.args)}`);
    } else {
      lines.push(`${item.toolName} ${item.output}`);
    }
  }
  return lines;
}
