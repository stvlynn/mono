# API Reference: `@mono/memory`

## Purpose

Describe the public storage and retrieval interfaces provided by the memory package.

## Main Components

Execution-memory and task-memory APIs:

- `FolderMemoryStore`
- `FolderTaskTodoStore`
- `DeterministicMemoryCompactor`
- `LocalMemoryRetrievalProvider`
- retrieval helpers in `retrieval/`

Structured-memory APIs:

- `FolderStructuredMemoryStore`
- `persistStructuredMemoryTurn`
- `StructuredMemoryRetrievalPlanner`
- `renderStructuredMemoryPackage`
- `resolvePrimaryEntityId`

## Distinction

`@mono/memory` now serves three distinct use cases:

- execution memory is append-only and trace-oriented
- task todo memory is mutable and task-oriented
- structured memory is local-first and entity-oriented

## Public Expectations

Execution-memory callers should expect:

- append-only `MemoryRecord` storage
- recall plans that expand compacted and raw-pair ids
- prompt rendering through the memory context templates

Structured-memory callers should expect:

- file-backed records grouped by self / others / project / episodic scope
- evidence-backed preference and inference updates
- query-driven package assembly for prompt injection

## Related Documents

- [`structured-memory.md`](./structured-memory.md)
- [`../architecture/memory-system.md`](../architecture/memory-system.md)
- [`../architecture/structured-memory-v2.md`](../architecture/structured-memory-v2.md)
