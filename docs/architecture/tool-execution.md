# Tool Execution

## Purpose

Document how tools are declared, scheduled, approved, and persisted.

## Built-in Tools

Current built-ins:

- `read`
- `write`
- `edit`
- `bash`
- `write_todos` inside agent-core task wiring

## Tool Metadata

Each tool can expose execution metadata:

- `executionMode`
  - `serial`
  - `parallel_readonly`
- `conflictKey`

This metadata is consumed by the tool batch scheduler.

## Batch Scheduler

The scheduler lives in `packages/llm/src/adapters/tool-batch-scheduler.ts`.

Current behavior:

- if a batch contains only readonly tools marked `parallel_readonly`, it may run in parallel
- if the batch mixes readonly and mutating tools, it falls back to serial execution
- final tool result messages are written back in request order for deterministic history

## Parse Errors

Tool argument parse failures are surfaced as tool error results, not hard scheduler crashes.

## Permissions

Permissions are handled in `packages/tools/src/permission.ts`.

Default policy:

- `read`: allow
- `bash`: ask, with denylist for destructive commands
- other mutating tools: ask

Channel-aware behavior:

- permission requests may include an optional channel context
- the current Telegram integration can allow specific chat ids to bypass interactive approval
- destructive bash commands still hard-deny even on allowlisted channels
- Telegram-specific bash command denylist entries can deny commands before approval is considered

The TUI or CLI approval callback resolves permission requests.
