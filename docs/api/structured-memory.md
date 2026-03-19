# API Reference: Structured Memory

## Purpose

Describe the public interfaces that implement `memory-v2`.

## Main Files

- `packages/memory/src/structured-store.ts`
- `packages/memory/src/structured-pipeline.ts`
- `packages/memory/src/structured-retrieval.ts`
- `packages/memory/src/structured-renderer.ts`
- `packages/memory/src/entity-resolver.ts`

## Store Layer

`FolderStructuredMemoryStore` owns the local file-backed store under `.mono/memory-v2/`.

Key responsibilities:

- initialize the self / others / project / episodic layout
- read and write self records
- read and write self runtime state
- read and write per-entity profile, preference, inference, and relationship records
- append and list conflict records
- append evidence rows
- append episodic events
- maintain the salience queue used by consolidation

Important expectation:

- this store is the authoritative source for structured memory

## Turn Pipeline

`persistStructuredMemoryTurn()` is the fast-path structured write used by the agent after a turn.

It currently performs:

- episodic event capture
- explicit preference extraction
- evidence write
- salience-queue append
- self-runtime update

`runStructuredMemoryConsolidation()` is the second-stage promotion step.

It currently performs:

- preference promotion from queued observations
- conflict recording for contradictory signals
- lightweight inference derivation
- relationship-state update
- self-runtime refresh
- narrative update append
- queue processing

It does not currently provide:

- a separate review queue
- offline promotion jobs
- human-in-the-loop conflict resolution

## Retrieval Layer

`StructuredMemoryRetrievalPlanner` builds a `StructuredMemoryPackage` from local records plus optional external retrieval items.

The planner is responsible for:

- ranking preferences and inferences against the active query
- selecting a bounded set of episodic events
- loading evidence samples referenced by selected records
- shaping a package that the prompt renderer can consume directly

## Rendering Layer

`renderStructuredMemoryPackage()` renders a package into the `memory/structured_context_block` prompt template.

This keeps prompt generation centralized in template rendering instead of ad hoc string assembly inside the agent.

## Entity Resolution

`resolvePrimaryEntityId()` currently resolves the configured primary user entity id from `mono.memory.v2.primaryEntityId`.

This is the current v1 entity-selection strategy.

## Key Shared Types

Important cross-package types live in `@mono/shared`:

- `MonoMemoryV2Config`
- `MemoryEvidenceRecord`
- `SelfRuntimeRecord`
- `SelfIdentityRecord`
- `OtherEntityProfileRecord`
- `OtherPreferencesRecord`
- `OtherInferenceRecord`
- `OtherConflictRecord`
- `OtherRelationshipStateRecord`
- `EpisodicEventRecord`
- `SalienceQueueRecord`
- `StructuredMemoryPackage`

## Related Documents

- [`memory.md`](./memory.md)
- [`../architecture/structured-memory-v2.md`](../architecture/structured-memory-v2.md)
