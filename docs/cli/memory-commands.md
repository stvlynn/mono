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

## OpenViking Evaluation Commands

The OpenViking commands are evaluation-oriented, not default runtime behavior.

### `mono memory compare <query>`

Runs both:

- local execution-memory recall
- OpenViking retrieval

and prints both context blocks for comparison.

### `mono memory openviking-status`

Runs a health check against the configured OpenViking endpoint.

### `mono memory export-openviking [id]`

Shadow-exports a local execution-memory record into OpenViking session extraction.

If no id is given, the latest local execution-memory record is used.

## Important Boundary

These commands do not migrate the live runtime to OpenViking.

They are for:

- retrieval comparison
- adapter validation
- migration feasibility work

## SeekDB Evaluation Commands

The SeekDB commands are also evaluation-oriented and do not replace the local runtime by default.

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

- local JSONL remains the source of truth
- mirrored sessions are for search and migration analysis
