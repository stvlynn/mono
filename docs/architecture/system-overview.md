# System Overview

## Purpose

This document describes how the `mono` runtime fits together.

## Audience

- contributors trying to understand the full runtime path
- maintainers debugging cross-package behavior

## Scope

This is the high-level architecture document. For subsystem specifics, use the linked docs in this directory.

## Core Runtime Path

A typical interactive request follows this path:

1. `packages/cli` constructs an `Agent`
2. `packages/tui` mounts the Ink app and bridges runtime events into UI state
3. `Agent.initialize()` resolves config, profile, model, session, and memory stores
4. `Agent.runTask()` creates task state and runs task/turn orchestration
5. `packages/llm` sends prompts through an `xsai` adapter
6. tool calls are executed through the batch scheduler
7. tool results, task state, memory updates, and session entries are appended
8. runtime events flow back into the TUI or print-mode output

## Main State Stores

### Machine-level state

Stored under `~/.mono`:

- `config.json`
- `local/secrets.json`
- `sessions/`

### Project-level state

Stored under the current workspace:

- `.mono/memories/` for execution memory and task todo records

## Main Components

### CLI

`packages/cli`

Responsibilities:

- command parsing
- auth/config/memory command handling
- choosing interactive mode vs `--print`

### TUI

`packages/tui`

Responsibilities:

- Ink UI composition
- input handling
- dialog lifecycle
- mapping runtime events into visible state

### Agent

`packages/agent-core`

Responsibilities:

- initialize config/model/session/memory
- run tasks and turns
- inject memory and task context
- verify and summarize
- emit runtime events

### LLM layer

`packages/llm`

Responsibilities:

- resolve models
- route to the correct adapter
- normalize provider interactions
- schedule tool calls through the tool batch scheduler

### Tools

`packages/tools`

Responsibilities:

- filesystem and shell tools
- permission wrapping
- execution metadata such as serial vs readonly parallel mode

### Session store

`packages/session`

Responsibilities:

- append-only JSONL history
- branch heads and checkout
- replay and node listing
- task pointers and summaries

### Memory store

`packages/memory`

Responsibilities:

- execution memory records
- retrieval and compaction helpers
- mutable task todo records

## Simplified Architecture Diagram

```text
CLI / TUI
   |
   v
Agent
   |
   +--> Config
   +--> Session
   +--> Memory
   +--> Prompts
   |
   v
LLM Router / Adapter
   |
   v
Tool Batch Scheduler
   |
   v
Tools
```

## Cross-Cutting Concerns

- prompt templates are centralized in `@mono/prompts`
- shared cross-package types live in `@mono/shared`
- runtime events are the main bridge from agent/runtime into the TUI
- config resolution influences model selection, memory settings, and session paths

## Related Documents

- [`monorepo-structure.md`](./monorepo-structure.md)
- [`runtime-lifecycle.md`](./runtime-lifecycle.md)
- [`task-runtime.md`](./task-runtime.md)
- [`tool-execution.md`](./tool-execution.md)
- [`event-model.md`](./event-model.md)
