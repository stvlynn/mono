# Task Runtime

## Purpose

Describe how `mono` executes a user request as a task.

## Current Model

`mono` uses a task runtime on top of a turn-based LLM/tool loop.

The main entrypoint is `Agent.runTask()` in `packages/agent-core/src/agent.ts`.

Not every request follows the same verification path:

- direct questions, explain/summarize-style prompts, and lightweight repository queries default to single-pass execution with `verification=none`
- implementation and change-oriented requests still use the execute/verify loop

Telegram `channel_chat` turns reuse the same runtime entrypoint, but they are assembled with extra channel-specific context:

- `interactionMode: "channel_chat"`
- optional `extraTaskContext` for chat continuation state
- the same shared session history as the main TUI run

Heartbeat curiosity probes also reuse the same runtime entrypoint with a dedicated lightweight mode:

- `interactionMode: "curiosity"`
- read-only sandbox and a tighter autonomy lease
- `verification=none`
- only `read` and protected `bash`; no `write_todos`, `write`, or `edit`
- curiosity probes are framed as lightweight background exploration, not repo-only scanning

## Task Shell

A task starts with a lightweight `TaskState`:

- `taskId`
- `goal`
- `phase`
- `attempts`
- `verification`
- optional `currentTodoMemoryId`
- optional `origin` (`user`, `heartbeat`, or `resume`)
- optional `parentIntentId` for heartbeat-created work
- optional autonomy `lease`

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
- heartbeat-created work still reuses the same task runtime rather than a separate execution engine

## Verification

Verification mode is one of:

- `none`
- `light`
- `strict`

Verification is still runtime-controlled. The model can update the todo list if verification finds missing work.

Current direct-response behavior:

- `verification=none` skips the verify phase entirely
- the execute prompt tells the model to answer directly and only use tools when they provide concrete evidence
- this keeps casual chat and lightweight questions from generating extra verifier-only assistant turns
- Telegram `channel_chat` turns force this direct-response path and do not expose `write_todos` or the full coding toolset
- allowlisted Telegram `channel_chat` turns may expose `bash`, but still do not expose `read`, `write`, or `edit`
- `verification=light` can also short-circuit to summarize when a turn produced a normal assistant reply and no tool evidence was needed
- light verification that only failed due to missing evidence does not re-open execution if the verify turn also produced no tool evidence

## Autonomy Heartbeat

The runtime now includes a low-frequency autonomy heartbeat layered on top of normal user tasks.

Current behavior:

- heartbeat runs only while the agent process is alive and idle
- it reads structured runtime state, learning state, recent feedback, and task todo records
- it can enqueue or resume a task by calling back into `Agent.runTask()`
- low-risk idle probes can now enqueue a `curiosity_probe` task from recent session/runtime context when no stalled-task or explicit gap candidate is available
- repeated low-value heartbeat work is suppressed through topic-level repetition / boredom tracking instead of content-specific hardcoded filters
- autonomous tasks are marked in `TaskState.origin`
- autonomous tasks receive a bounded `lease` so they do not run indefinitely
- recent user feedback can suppress or down-rank autonomous work through learning-state bias
- `allowBroadExecution=false` forces medium/high-risk autonomous work to stop at a confirmation boundary

This is intentionally a control loop, not a separate background worker system.

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

Important current detail for Telegram:

- handoff agents may run in parallel while still appending into the same shared session
- reply/summary consumers should only use visible `text` parts, not `thinking` parts

The session also records:

- task pointers
- task summaries
- compression entries when applicable

## Known Limits

- phase progression is still runtime-owned, not fully planner-owned
- verification is rule-based, not a separate verifier agent
- subagents do not exist yet
