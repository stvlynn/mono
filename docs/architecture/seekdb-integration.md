# SeekDB Integration

## Purpose

Describe the current SeekDB evaluation boundary in `mono`, what it can already do, and what remains intentionally local.

## Current Position

`mono` does **not** migrate its default runtime state to SeekDB.

The current SeekDB work is an evaluation path for:

- execution-memory storage experiments
- retrieval experiments
- session mirroring for search and migration analysis

The default runtime remains local.

## What Stays Local

These remain the source of truth:

- `FolderMemoryStore` for local execution memory
- `FolderTaskTodoStore` for mutable task todo state
- `SessionManager` for append-only JSONL replay and branch switching

Task todo memory is explicitly out of scope for SeekDB migration. The current `write_todos` flow still depends on local overwrite-in-place semantics.

## Supported Evaluation Modes

SeekDB configuration lives under `mono.memory.seekDb`.

The current adapter supports two modes:

- `mysql`
- `python-embedded`

The recommended primary path is `mysql` mode because it fits the existing Node/TypeScript runtime more cleanly.

## Implemented Adapter Layer

The current adapter package is:

- `packages/seekdb-adapter`

Key pieces:

- `SeekDbExecutionMemoryBackend`
- `SeekDbRetrievalProvider`
- `SeekDbSessionMirror`
- `SeekDbMySqlRunner`
- `SeekDbPythonEmbeddedRunner`

These are evaluation adapters. They do not replace the current local runtime by default.

## Execution Memory Flow

`mono memory export-seekdb [id]` takes a local `MemoryRecord` and writes it into SeekDB-backed execution-memory storage through the adapter.

This is one-way evaluation write behavior:

1. load a local memory record
2. map it to SeekDB-backed storage
3. store it through the selected runner

It does not change the normal local append path.

## Retrieval Flow

`mono memory compare-seekdb <query>` compares:

- local recall
- SeekDB-backed retrieval

The SeekDB retrieval provider:

1. searches execution-memory rows
2. optionally includes mirrored session matches
3. renders the result through `memory/seekdb_context_block`

This keeps prompt rendering under `mono`'s control instead of injecting raw database rows.

## Session Mirroring

`mono memory mirror-session-seekdb [sessionId]` mirrors one local JSONL session into SeekDB for evaluation.

Important boundary:

- local JSONL remains authoritative
- mirrored entries are for search and migration analysis
- branch replay still happens locally

This is the maximum safe session integration currently implemented.

## What SeekDB Does Not Own

The SeekDB evaluation path does **not** currently own:

- session replay
- branch checkout
- current task loading
- task pointer truth
- task todo storage

Those are all still local runtime responsibilities.

## Risks

The main migration risks are:

- exact branch replay mismatch if SeekDB were made authoritative for sessions
- higher runtime and deployment complexity, especially in `python-embedded` mode
- reduced inspectability compared to local JSON and JSONL files
- retrieval behavior drift if database ranking does not match current prompt expectations

## Recommended Direction

The current recommendation remains:

1. use SeekDB only for evaluation
2. treat execution memory as the primary candidate for migration
3. keep session migration at mirror/index level unless exact replay can be proven
4. keep task todo memory local
