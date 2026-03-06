import type { AgentTool, TaskItem, TaskTodoRecord } from "@mono/shared";
import { createTaskTodoRecord } from "./memory-runtime.js";
import type { TaskTodoStore } from "@mono/memory";

interface CreateWriteTodosToolOptions {
  cwd: string;
  taskId: string;
  goal: string;
  sessionId: string;
  branchHeadId?: string;
  verificationMode: TaskTodoRecord["verificationMode"];
  store: TaskTodoStore;
  onUpdated: (record: TaskTodoRecord | null) => void;
}

interface WriteTodosArgs {
  todos: TaskItem[];
}

function normalizeTodos(todos: TaskItem[]): TaskItem[] {
  const normalized = todos
    .filter((todo) => typeof todo.description === "string" && todo.description.trim().length > 0)
    .map((todo, index) => ({
      id: todo.id?.trim() || `todo-${index + 1}`,
      description: todo.description.trim(),
      status: todo.status
    }));

  const inProgressCount = normalized.filter((todo) => todo.status === "in_progress").length;
  if (inProgressCount > 1) {
    throw new Error('Only one todo can be "in_progress" at a time.');
  }

  return normalized;
}

export function createWriteTodosTool(options: CreateWriteTodosToolOptions): AgentTool<WriteTodosArgs> {
  return {
    name: "write_todos",
    description: "Create or update the current task plan for this task. Provide the full todo list each time.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        todos: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string" },
              description: { type: "string" },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed", "cancelled"]
              }
            },
            required: ["description", "status"]
          }
        }
      },
      required: ["todos"]
    },
    parseArgs(args) {
      const input = args as { todos?: TaskItem[] };
      if (!Array.isArray(input.todos)) {
        throw new Error("write_todos requires a todos array.");
      }
      return { todos: input.todos };
    },
    async execute(args) {
      const existing = await options.store.get(options.taskId);
      const todos = normalizeTodos(args.todos);

      if (todos.length === 0) {
        await options.store.clear(options.taskId);
        options.onUpdated(null);
        return {
          content: "Cleared the current todo list."
        };
      }

      const record = createTaskTodoRecord({
        taskId: options.taskId,
        goal: options.goal,
        sessionId: options.sessionId,
        branchHeadId: options.branchHeadId,
        cwd: options.cwd,
        verificationMode: options.verificationMode,
        existing,
        todos
      });

      await options.store.upsert(record);
      options.onUpdated(record);

      return {
        content: `Updated ${todos.length} todo item(s).`
      };
    }
  };
}
