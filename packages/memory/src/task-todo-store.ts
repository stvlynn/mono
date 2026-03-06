import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TaskTodoRecord } from "@mono/shared";

export interface TaskTodoStore {
  get(taskId: string): Promise<TaskTodoRecord | null>;
  getCurrentForSession(sessionId: string, branchHeadId?: string): Promise<TaskTodoRecord | null>;
  upsert(record: TaskTodoRecord): Promise<void>;
  clear(taskId: string): Promise<void>;
  listBySession(sessionId: string): Promise<TaskTodoRecord[]>;
}

export class FolderTaskTodoStore implements TaskTodoStore {
  constructor(readonly root: string) {}

  async get(taskId: string): Promise<TaskTodoRecord | null> {
    const filePath = this.pathFor(taskId);
    try {
      return JSON.parse(await readFile(filePath, "utf8")) as TaskTodoRecord;
    } catch {
      return null;
    }
  }

  async getCurrentForSession(sessionId: string, branchHeadId?: string): Promise<TaskTodoRecord | null> {
    const records = await this.listBySession(sessionId);
    const scoped = branchHeadId ? records.filter((record) => record.branchHeadId === branchHeadId) : records;
    return scoped.sort((left, right) => right.updatedAt - left.updatedAt || right.id.localeCompare(left.id))[0] ?? null;
  }

  async upsert(record: TaskTodoRecord): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await writeFile(this.pathFor(record.taskId), JSON.stringify(record, null, 2), "utf8");
  }

  async clear(taskId: string): Promise<void> {
    await rm(this.pathFor(taskId), { force: true }).catch(() => undefined);
  }

  async listBySession(sessionId: string): Promise<TaskTodoRecord[]> {
    const entries = await readdir(this.root).catch(() => []);
    const records = await Promise.all(
      entries
        .filter((entry) => entry.endsWith(".json"))
        .map(async (entry) => JSON.parse(await readFile(join(this.root, entry), "utf8")) as TaskTodoRecord)
    );
    return records
      .filter((record) => record.sessionId === sessionId)
      .sort((left, right) => left.updatedAt - right.updatedAt || left.id.localeCompare(right.id));
  }

  private pathFor(taskId: string): string {
    return join(this.root, `${taskId}.json`);
  }
}
