# OpenViking Integration

## Purpose

Describe how `mono` integrates with `volcengine/OpenViking` today, what remains local, and why the runtime uses a hybrid architecture instead of an OpenViking-authoritative design.

## Current Position

`mono` uses OpenViking as a hybrid retrieval and shadow-sync layer.

OpenViking currently supports:

- retrieval for execution-memory experiments and runtime recall
- retrieval augmentation for structured memory packages
- shadow export of execution-memory records
- shadow export of structured-memory snapshots

The default runtime truth remains local.

## What Stays Local

The following remain authoritative in `mono`:

- `FolderMemoryStore` for execution memory
- `FolderTaskTodoStore` for mutable task todo state
- `SessionManager` for session append, replay, and branch switching
- `FolderStructuredMemoryStore` for self / other / project / episodic memory

This means:

- task planning still uses local task todo memory
- session replay still uses local JSONL files
- branch checkout semantics are unchanged by OpenViking
- structured memory mutations always happen locally first

## What OpenViking Owns

OpenViking acts as a retrieval and indexing layer for local canonical data.

In practice it is used for:

- semantic search over externalized memory snapshots
- cross-type retrieval augmentation
- extraction-driven shadow sync validation
- future migration experiments that still preserve local truth

It does **not** own:

- authoritative session history
- branch semantics
- mutable task todo state
- canonical structured-memory writes

## Implemented Adapter Layer

The current adapter package is:

- `packages/openviking-adapter`

Key pieces:

- `OpenVikingHttpClient`
- `OpenVikingRetrievalProvider`
- `OpenVikingShadowExporter`
- `OpenVikingStructuredShadowExporter`

These map OpenViking's HTTP API into `mono` retrieval and shadow-sync flows without changing local truth.

## Retrieval Flows

### Execution-memory retrieval

When `mono.memory.retrievalBackend=openviking`, the runtime delegates execution-memory recall to `OpenVikingRetrievalProvider`.

That provider may:

1. derive a query from the current turn
2. optionally sync recent user and assistant messages into an ephemeral OpenViking session
3. run OpenViking search
4. normalize results into `RetrievedContext`
5. render `memory/openviking_context_block`

### Structured-memory augmentation

When structured memory builds a `StructuredMemoryPackage`, the runtime may also ask OpenViking for external items and merge them into the package.

Important detail:

- OpenViking external items are treated as augmentation candidates
- the final prompt still uses the local package renderer
- local summaries and evidence stay primary

## Shadow Sync Flows

### Execution-memory shadow export

`OpenVikingShadowExporter` exports a `MemoryRecord` by:

1. creating an ephemeral OpenViking session
2. writing the record input as a user message
3. writing the record output, compacted steps, and trace summary as an assistant message
4. calling session extraction
5. deleting the ephemeral session

### Structured-memory shadow export

`OpenVikingStructuredShadowExporter` exports a structured-memory snapshot by:

1. creating an ephemeral OpenViking session
2. writing a stable snapshot id as the user message
3. writing the structured summary and detail lines as the assistant message
4. calling session extraction
5. deleting the ephemeral session

This is one-way and non-authoritative.

## Config Surface

OpenViking-related config lives under:

- `mono.memory.retrievalBackend`
- `mono.memory.fallbackToLocalOnFailure`
- `mono.memory.openViking`
- `mono.memory.v2.openVikingSync`

The nested `openViking` block currently supports:

- `enabled`
- `url`
- `apiKeyEnv`
- `agentId`
- `timeoutMs`
- `targetUri`
- `useSessionSearch`
- `shadowExport`

`mono.memory.v2.openVikingSync` currently supports:

- `off`
- `async`

## Failure Modes and Fallbacks

The runtime is designed to degrade gracefully.

If OpenViking retrieval fails:

- execution memory can fall back to local retrieval when `fallbackToLocalOnFailure=true`
- structured memory still builds a local package without external items

If OpenViking shadow sync fails:

- local memory writes still succeed
- shadow sync is treated as best-effort

## Why OpenViking Is Not Authoritative

OpenViking is not a drop-in replacement for the current runtime because `mono` depends on local semantics that OpenViking does not model directly:

- branch replay
- overwrite-style task todo state
- local-first structured memory mutation
- deterministic prompt assembly from local summaries and evidence

## Related Documents

- [`memory-system.md`](./memory-system.md)
- [`structured-memory-v2.md`](./structured-memory-v2.md)
- [`../decisions/0006-memory-v2-hybrid-openviking.md`](../decisions/0006-memory-v2-hybrid-openviking.md)
