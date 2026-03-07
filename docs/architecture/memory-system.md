# Memory System

## Purpose

Describe the two memory lanes used by `mono`.

## Two Distinct Memory Lanes

### Execution memory

Execution memory is append-only and stores reusable traces of prior work.

It includes:

- user input
- compacted steps
- final output
- detailed tool/assistant trace

### Task todo memory

Task todo memory is mutable and task-scoped.

It stores the current `TaskTodoRecord` for a task and is overwritten in place when `write_todos` updates the plan.

## Default Location

Project-local memory defaults to:

- `.mono/memories/`

Task todo records live under the task store path derived from that memory root.

## Recall Flow

During task execution, the agent may:

1. select memory roots
2. expand compacted/raw pair ids
3. render a memory context block into the prompt
4. persist a new execution memory record after the turn

## Todo Record Flow

1. task starts with a shell state
2. model may call `write_todos`
3. task todo store upserts the record for that task
4. next turn reads the latest todo record
5. TUI task tray reflects the current todo record

## Current Limits

- execution memory and task memory are filesystem-based, not vector-backed
- todo records are overwritten, not versioned

## SeekDB Evaluation Path

`mono` now also has a SeekDB evaluation path for:

- execution-memory persistence experiments
- retrieval experiments
- mirrored session search

What it does not do today:

- replace local execution memory as the default write path
- replace task todo memory
- replace local session replay

See [`seekdb-integration.md`](./seekdb-integration.md) for the boundary and risk analysis.

## OpenViking Evaluation Path

`mono` now has an optional OpenViking adapter, but it is intentionally scoped as an evaluation layer.

What it can do today:

- compare local retrieval with OpenViking retrieval
- shadow-export local execution-memory records into OpenViking extraction

What it does not do today:

- replace local execution memory as the default source of truth
- replace task todo memory
- replace session replay or branch semantics

See [`openviking-integration.md`](./openviking-integration.md) for the boundary and risk analysis.
