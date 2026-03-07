# ADR 0005: Readonly Tool Batches May Run in Parallel

## Context

Repository inspection tasks were slowed down by strictly serial execution even when the tool calls were independent and read-only.

## Decision

Allow readonly tools marked `parallel_readonly` to execute in parallel batches, while mutating or approval-requiring tools remain serial.

## Consequences

- read-heavy tasks become faster
- the scheduler must preserve deterministic result ordering
- loop detection must use normalized tool signatures, not tool names alone
