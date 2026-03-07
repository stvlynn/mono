# OpenViking Integration

## Purpose

Describe how `mono` integrates with `volcengine/OpenViking` today, what remains local, and why the integration is explicitly scoped as an evaluation path rather than a full backend migration.

## Current Position

`mono` does **not** replace its local memory, task, or session stores with OpenViking.

The current integration is limited to:

- optional retrieval evaluation against OpenViking
- optional shadow export of local execution-memory records into OpenViking session extraction

The default runtime remains local.

## Why This Is Evaluation-Only

OpenViking is not a drop-in replacement for `mono`'s current memory subsystem.

It is closer to a context database and retrieval runtime than a filesystem-backed execution-memory store.

`mono` currently depends on three distinct local state systems:

1. append-only execution memory
2. mutable task todo memory for `write_todos`
3. session JSONL plus branch-head replay

OpenViking aligns best with the first area and least with the second and third.

## What Stays Local

The following remain the source of truth in `mono`:

- `FolderMemoryStore` for execution memory
- `FolderTaskTodoStore` for task-scoped mutable todo state
- `SessionManager` for session append, replay, and branch switching

This means:

- task planning still uses local task todo memory
- session replay still uses local JSONL files
- branch checkout semantics are unchanged by OpenViking

## Implemented Adapter Layer

The current adapter package is:

- `packages/openviking-adapter`

Key pieces:

- `OpenVikingHttpClient`
- `OpenVikingRetrievalProvider`
- `OpenVikingShadowExporter`

These map OpenViking's HTTP API into `mono` evaluation flows without changing the local runtime truth.

## Retrieval Flow

When OpenViking retrieval is used for comparison:

1. `mono memory compare <query>` resolves the current local session and config
2. local recall still runs through the normal execution-memory path
3. the OpenViking provider optionally syncs recent user and assistant messages into an ephemeral OpenViking session
4. OpenViking search results are normalized into `RetrievedContext`
5. the result is rendered through a dedicated `memory/openviking_context_block` prompt template

This lets maintainers compare local and OpenViking retrieval quality without changing the task runtime.

## Shadow Export Flow

`mono memory export-openviking [id]` exports a local execution-memory record by:

1. creating an ephemeral OpenViking session
2. writing the record input as a user message
3. writing the record output plus compacted steps as an assistant message
4. calling OpenViking session extraction
5. deleting the ephemeral session

This is intentionally one-way and non-authoritative.

## Current Config Surface

OpenViking-related config lives under:

- `mono.memory.retrievalBackend`
- `mono.memory.fallbackToLocalOnFailure`
- `mono.memory.openViking`

The nested `openViking` block currently supports:

- `enabled`
- `url`
- `apiKeyEnv`
- `agentId`
- `timeoutMs`
- `targetUri`
- `useSessionSearch`
- `shadowExport`

## Constraints

The current integration deliberately does not do any of the following:

- replace local execution-memory append as the default write path
- replace task todo memory
- replace session replay or branch ownership
- inject OpenViking retrieval into the agent's normal auto-recall path by default

Those would all expand the scope from evaluation into runtime migration.

## Risks

Main risks if this integration were expanded too aggressively:

- task todo semantic loss
- session/branch replay mismatch
- runtime stack complexity from a Python-based dependency
- harder debugging compared to local JSON/JSONL inspection

## Recommended Next Step

If OpenViking is evaluated further, keep the rollout staged:

1. shadow retrieval comparison
2. optional retrieval backend experiments
3. shadow export for execution-memory records
4. no migration of task todo memory or session ownership unless the product direction changes materially
