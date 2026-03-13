# Memory Commands

## Current Commands

- `mono memory status`
- `mono memory list`
- `mono memory search <query>`
- `mono memory show <id>`
- `mono memory recall [query]`
- `mono memory compare <query>`
- `mono memory openviking-status`
- `mono memory export-openviking [id]`
- `mono memory seekdb-status`
- `mono memory compare-seekdb <query>`
- `mono memory export-seekdb [id]`
- `mono memory mirror-session-seekdb [sessionId]`

## Purpose

These commands expose project memory state for inspection and debugging.

## `mono memory status`

`mono memory status` now reports both memory lanes:

- execution-memory status
- `memory-v2` status

The command includes:

- execution-memory enabled / auto-inject flags
- retrieval backend and fallback behavior
- execution-memory store path
- `memory.v2.enabled`
- `memory.v2.storePath`
- `memory.v2.primaryEntityId`
- `memory.v2.openVikingSync`
- OpenViking and SeekDB integration status

Important limitation:

- this command reports `memory-v2` configuration only
- it does not yet enumerate or edit structured-memory records

## Execution-Memory Commands

The following commands still operate on execution memory (`MemoryRecord`) rather than structured memory:

- `mono memory list`
- `mono memory search`
- `mono memory show`
- `mono memory recall`

These are still useful because execution memory remains part of the runtime prompt path.

## OpenViking Commands

The OpenViking commands work as adapter and migration diagnostics, not as canonical-memory editors.

### `mono memory compare <query>`

Runs both:

- local execution-memory recall
- OpenViking retrieval

and prints both context blocks for comparison.

### `mono memory openviking-status`

Runs a health check against the configured OpenViking endpoint.

### `mono memory export-openviking [id]`

Shadow-exports a local execution-memory record into OpenViking session extraction.

If no id is given, the latest local memory record is used.

## SeekDB Commands

The SeekDB commands remain evaluation-oriented and do not replace local runtime truth.

### `mono memory seekdb-status`

Shows the active SeekDB mode and attempts lightweight execution-memory and session-mirror counts.

### `mono memory compare-seekdb <query>`

Runs both:

- local execution-memory recall
- SeekDB-backed retrieval

and prints both context blocks for comparison.

### `mono memory export-seekdb [id]`

Exports one local execution-memory record into SeekDB-backed execution-memory storage.

### `mono memory mirror-session-seekdb [sessionId]`

Mirrors one local JSONL session stream into SeekDB for evaluation.

Important boundary:

- local JSONL remains authoritative
- mirrored sessions are for search and migration analysis

## Related Documents

- [`commands.md`](./commands.md)
- [`../architecture/memory-system.md`](../architecture/memory-system.md)
- [`../architecture/openviking-integration.md`](../architecture/openviking-integration.md)
