# Event Model

## Purpose

Describe the runtime events that bridge the agent/runtime to the TUI and print mode.

## Event Source

`Agent` emits `RuntimeEvent` values defined in `@mono/shared`.

## Common Event Categories

- assistant lifecycle
  - `assistant-start`
  - `assistant-text-delta`
  - `assistant-thinking-delta`
- tool lifecycle
  - `tool-start`
  - `tool-update`
  - `tool-end`
- task lifecycle
  - `task-start`
  - `task-update`
  - `task-phase-change`
  - `task-verify-start`
  - `task-verify-result`
  - `task-summary`
  - `loop-detected`
- memory/session lifecycle
  - `memory-recalled`
  - `memory-persisted`
  - `session-compressed`
- run lifecycle
  - `run-end`
  - `run-aborted`
  - `error`
- approval lifecycle
  - `approval-request`
  - `approval-result`

## Main Consumer

`packages/tui/src/hooks/useAgentBridge.ts` is the main UI reducer/bridge from runtime events to UI state.

## Print Mode Consumer

`packages/cli/src/main.ts` converts a subset of the same events into stdout/stderr output.
