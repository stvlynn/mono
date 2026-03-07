# ADR 0001: Config Home Is `~/.mono`

## Context

The project needed a stable machine-level home for config, secrets, and sessions.

## Decision

Use `~/.mono` as the primary machine-level home.

## Consequences

- config, secrets, and sessions are colocated
- CLI and TUI can share a single summary path
- legacy paths may need compatibility logic during migration
