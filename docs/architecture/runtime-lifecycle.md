# Runtime Lifecycle

## Purpose

Explain how a `mono` process starts, runs, and exits.

## Interactive Mode Lifecycle

1. `packages/cli/src/main.ts` parses args
2. CLI constructs `new Agent(...)`
3. CLI lazily imports `@mono/tui`
4. TUI mounts `AppContainer`
5. `useAgentBridge()` calls `agent.initialize()`
6. UI renders initial state and waits for user input
7. prompt submission calls `agent.runTask()`
8. runtime events update the TUI until `run-end`, `run-aborted`, or `error`

## Print Mode Lifecycle

1. `mono --print ...` constructs an `Agent`
2. optional readline-based approval callback is attached
3. `runTask()` executes once
4. assistant text deltas stream to stdout
5. task/tool status lines stream to stderr
6. process exits when the task completes or errors

## Initialization Details

`Agent.initialize()` currently resolves:

- model/profile config
- config summary
- session manager
- memory store
- task todo store
- previously loaded messages when `--continue` is used
