# ADR 0006: Memory v2 Uses Local Canonical Storage with Hybrid OpenViking Retrieval

## Context

`mono` needed a richer long-term memory system for self, other, project, and episodic context without breaking local session replay or task todo semantics.

At the same time, OpenViking was useful for retrieval augmentation and shadow-sync experiments, but it did not model local branch replay or mutable task state.

## Decision

Adopt a local-first `memory-v2` architecture:

- structured memory is stored locally under `.mono/memory-v2/`
- session replay remains local and authoritative
- task todo state remains local and authoritative
- OpenViking is used as a hybrid retrieval and async shadow-sync layer
- prompt injection uses rendered local memory packages rather than raw OpenViking results

## Consequences

- local runtime behavior stays debuggable and deterministic
- OpenViking can improve retrieval quality without owning canonical writes
- execution memory and structured memory remain separate subsystems
- future migration to a more authoritative remote memory backend would require a new decision
