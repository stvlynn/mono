import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FolderTaskTodoStore } from "../packages/memory/src/index.js";
import { createTaskTodoRecord } from "../packages/agent-core/src/memory-runtime.js";

describe("task todo store", () => {
  it("overwrites the current task todo record in place", async () => {
    const root = await mkdtemp(join(tmpdir(), "mono-task-todos-"));
    const store = new FolderTaskTodoStore(root);
    const initial = createTaskTodoRecord({
      taskId: "task-1",
      goal: "fix tests",
      sessionId: "session-1",
      cwd: root,
      verificationMode: "strict",
      todos: [{ id: "todo-1", description: "Run the tests", status: "in_progress" }]
    });

    await store.upsert(initial);

    const updated = createTaskTodoRecord({
      taskId: "task-1",
      goal: "fix tests",
      sessionId: "session-1",
      cwd: root,
      verificationMode: "strict",
      existing: initial,
      todos: [{ id: "todo-2", description: "Re-run the tests", status: "in_progress" }]
    });

    await store.upsert(updated);

    const loaded = await store.get("task-1");

    expect(loaded?.id).toBe(initial.id);
    expect(loaded?.todos).toEqual(updated.todos);
    expect(loaded?.updatedAt).toBeGreaterThanOrEqual(initial.updatedAt);
  });
});
