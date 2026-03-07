# Task Runtime

## Purpose

Describe how `mono` executes a user request as a task.

## Current Model

`mono` uses a task runtime on top of a turn-based LLM/tool loop.

The main entrypoint is `Agent.runTask()` in `packages/agent-core/src/agent.ts`.

## Task Shell

A task starts with a lightweight `TaskState`:

- `taskId`
- `goal`
- `phase`
- `attempts`
- `verification`
- optional `currentTodoMemoryId`

The task state does not own the todo list directly.

## Todo Planning

Current todo planning is memory-backed:

- the model can call `write_todos`
- the current todo record is stored as a mutable `TaskTodoRecord`
- each turn reads the latest todo record for the active task

This is implemented through:

- `packages/agent-core/src/task-todo-tool.ts`
- `packages/memory/src/task-todo-store.ts`

## Task Phases

Current phases:

- `plan`
- `execute`
- `verify`
- `summarize`
- `done`
- `blocked`
- `incomplete`
- `aborted`

Important detail:
- the runtime still owns phase transitions and verification rails
- the model owns todo decomposition through `write_todos`

## Verification

Verification mode is one of:

- `none`
- `light`
- `strict`

Verification is still runtime-controlled. The model can update the todo list if verification finds missing work.

## Loop Detection

Loop detection currently checks:

- repeated tool signatures (`toolName + normalized input`)
- repeated identical assistant output

It no longer treats consecutive reads of different files as a loop.

## Output and Completion

A completed task yields:

- `TaskResult.status`
- `TaskResult.summary`
- final verification state
- collected task messages

The session also records:

- task pointers
- task summaries
- compression entries when applicable

## Known Limits

- phase progression is still runtime-owned, not fully planner-owned
- verification is rule-based, not a separate verifier agent
- subagents do not exist yet
