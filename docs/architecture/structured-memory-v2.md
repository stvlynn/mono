# Structured Memory v2

## Purpose

Describe the local-first structured memory system introduced alongside execution memory and task todo state.

## Design Goals

`memory-v2` exists to capture longer-lived behavioral and relationship context without overloading execution-memory traces.

The design goals are:

- keep local canonical state for self / other / project / episodic memory
- require evidence before stable preference or inference records become useful
- keep session replay and task todo state outside this subsystem
- inject compact summaries into prompts instead of raw files or raw transcripts
- treat OpenViking as retrieval and sync infrastructure, not as the source of truth

## Storage Layout

The default project-local root is:

- `.mono/memory-v2/`

Subdirectories:

- `self/`
- `others/<entityId>/`
- `project/`
- `episodic/`

`FolderStructuredMemoryStore` owns this layout.

## Record Types

### Self records

Stored under `self/`:

- `identity.json`
- `values.json`
- `traits.json`
- `roles.json`
- `guides.json`
- `narrative.jsonl`

These describe stable identity, constraints, values, roles, and self-guidance.

### Other-entity records

Stored under `others/<entityId>/`:

- `profile.json`
- `preferences.json`
- `inferred_traits.json`
- `relationship_state.json`
- `evidence.jsonl`

These records are intentionally split:

- facts and communication notes live in `profile.json`
- stable preferences live in `preferences.json`
- higher-level inferences live in `inferred_traits.json`
- all non-trivial conclusions should remain traceable through `evidence.jsonl`

### Project records

Stored under `project/`:

- `workspace_profile.json`

This stores durable workspace facts and collaboration norms that are useful across runs.

### Episodic records

Stored under `episodic/`:

- `events.jsonl`

Each event captures a turn-level summary, salience, and extracted candidate keys.

## Turn Write Pipeline

`persistStructuredMemoryTurn()` is the main write entrypoint.

For each persisted turn it:

1. appends an episodic event
2. extracts explicit preference evidence from the user message
3. writes evidence records to the per-entity ledger
4. consolidates preference records
5. derives lightweight inference records when enabled
6. updates relationship state
7. updates communication notes on the entity profile

This pipeline is intentionally heuristic and local-first. It does not run a separate background promotion job yet.

## Retrieval Planner and Memory Package

`StructuredMemoryRetrievalPlanner` builds a `StructuredMemoryPackage` for the active entity.

The package combines:

- self identity summary
- project memory summary
- entity profile summary
- relevant preferences
- relevant inferences
- relationship state
- recent episodic events
- evidence samples referenced by selected entries
- optional external retrieval items

The planner currently ranks:

- preferences by query token overlap plus confidence
- inferences by query overlap, confidence, and status bonus
- episodic events by query overlap plus salience

## Rendering and Prompt Injection

The package is rendered through:

- `memory/structured_context_block`

`Agent` then joins:

- execution-memory recall context
- structured-memory context
- optional OpenViking external items folded into the package

This means the prompt sees rendered summaries and evidence, not raw structured-memory files.

## Seeding from Workspace Files

On initialization, the agent seeds parts of structured memory from workspace bootstrap files when local records are empty:

- `.mono/IDENTITY.md`
- `.mono/CONTEXT.md`
- `.mono/MEMORY.md`
- `README.md`

This is a bootstrap convenience, not a continuous sync mechanism.

## OpenViking Sync Model

When `mono.memory.v2.openVikingSync=async`, the runtime may shadow-export:

- the latest episodic event
- selected preference snapshots
- selected inference snapshots

The export path is best-effort and non-authoritative.

## Safety and Correctness Boundaries

Current safeguards:

- structured memory is local-first
- evidence is stored separately from inferences
- session replay is still handled outside `memory-v2`
- task todo state is still handled outside `memory-v2`
- prompt injection uses rendered summaries, not raw record files

Current limits:

- there is no standalone CLI editor or inspector for structured memory records
- promotion and decay are encoded as local heuristics, not a background service
- inference remains intentionally lightweight and conservative

## Related Documents

- [`memory-system.md`](./memory-system.md)
- [`openviking-integration.md`](./openviking-integration.md)
- [`../api/structured-memory.md`](../api/structured-memory.md)
