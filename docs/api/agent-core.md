# API Reference: `@mono/agent-core`

## Purpose

Summarize the maintainer-facing contract of the agent runtime.

## Main Entry

`packages/agent-core/src/agent.ts`

## Key Responsibilities

- initialize model, config, session, and memory dependencies
- run tasks and turns
- emit runtime events
- manage task todo memory
- expose read APIs used by CLI and TUI
- support cancellation through `abort()`

## Important Public Methods

- `initialize()`
- `runTask(input)`
- `prompt(input)`
- `abort()`
- `isRunning()`
- `listProfiles()` / `setProfile()`
- `listModels()` / `setModel()`
- `listSessions()` / `switchSession()`
- `listSessionNodes()` / `switchBranch()`
- memory inspection helpers used by CLI and TUI

## Important Contracts

- `runTask()` is the preferred execution entrypoint
- `prompt()` is compatibility sugar over task execution
- `abort()` must stop the active run and prevent stale results from landing
