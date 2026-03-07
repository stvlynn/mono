# ADR 0002: Task Todos Are Backed by Memory

## Context

Hard-coded task todo state was too rigid and did not match model-authored planning well.

## Decision

Use mutable task todo records in project memory and let the model update them with `write_todos`.

## Consequences

- task state stays lightweight
- current todo lists survive across turns and resumes
- todo history is overwrite-based rather than version-chained
