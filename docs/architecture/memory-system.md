# Memory System

## Purpose

Describe the memory layers used by `mono`, which stores are authoritative, and how memory is injected into agent runs.

## Memory Layers

`mono` now has four distinct memory lanes:

### Session memory

Session memory is the append-only JSONL transcript managed by `SessionManager`.

It stores:

- user, assistant, and tool messages
- branch heads and replay pointers
- task pointers and task summaries
- session compression entries

Session memory remains the source of truth for replay, branch checkout, and recent conversation state.

### Execution memory (`memory v1`)

Execution memory is append-only and stores reusable traces of prior work.

It includes:

- user input
- compacted steps
- final output
- detailed tool and assistant trace

This lane is still the source of truth for the existing `MemoryRecord` retrieval path.

### Task todo memory

Task todo memory is mutable and task-scoped.

It stores the current `TaskTodoRecord` for a task and is overwritten in place when `write_todos` updates the plan.

### Structured memory (`memory v2`)

Structured memory is the new local-first long-term memory layer used for:

- self identity and behavior constraints
- per-entity profiles, preferences, and inference records
- project-level durable facts
- episodic event capture for later promotion

Structured memory is stored locally and is the canonical source for these higher-level records.

## Authoritative Stores

The current authoritative sources are:

- `SessionManager` for session replay and branching
- `FolderTaskTodoStore` for mutable task state
- `FolderMemoryStore` for execution-memory records
- `FolderStructuredMemoryStore` for self / other / project / episodic memory

`OpenViking` is not an authoritative store. It acts as a hybrid retrieval and async shadow-sync layer on top of local structured and execution memory.

## Default Locations

Project-local memory defaults to:

- `.mono/memories/` for execution memory and task todo records
- `.mono/memory-v2/` for structured memory

Structured memory is further split into:

- `self/`
- `others/`
- `project/`
- `episodic/`

## Write Path

During a normal task turn, the runtime may:

1. append user and assistant messages to the session store
2. compact and persist a `MemoryRecord` into execution memory
3. capture an episodic structured-memory event
4. extract evidence-backed preference candidates from the user turn
5. consolidate preferences and lightweight inferences into per-entity structured memory
6. update relationship state and profile notes
7. optionally mirror execution and structured memory into OpenViking

Execution memory and structured memory are intentionally separate:

- execution memory optimizes trace reuse
- structured memory optimizes stable behavioral and relationship context

## Read and Injection Path

Prompt assembly now combines three memory inputs:

1. execution-memory recall from the configured retrieval backend
2. structured memory packages built locally for the active entity
3. optional OpenViking retrieval items merged into the structured package

The agent does not inject raw structured-memory files or raw OpenViking results directly into the prompt. It injects rendered context blocks after local planning and summarization.

## Current Operational Boundary

What this system does today:

- keeps session replay local
- keeps task todo state local
- stores structured memory locally
- augments prompt context with structured summaries and evidence
- uses OpenViking for retrieval augmentation and async shadow sync

What it does not do today:

- migrate session truth into OpenViking
- migrate task todo truth into OpenViking
- expose dedicated CLI subcommands for editing structured-memory records
- run a separate background consolidation daemon

## Related Documents

- [`structured-memory-v2.md`](./structured-memory-v2.md)
- [`openviking-integration.md`](./openviking-integration.md)
- [`prompt-system.md`](./prompt-system.md)
- [`../api/memory.md`](../api/memory.md)
- [`../api/structured-memory.md`](../api/structured-memory.md)
