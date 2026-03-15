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
2. `packages/tui` mounts the Ink app, manages pending image attachments, and bridges runtime events into UI state
3. local or platform entrypoints normalize text and images into a shared `TaskInput`
4. `Agent.initialize()` resolves config, profile, model, session, and memory stores
5. `Agent.runTask()` creates task state and runs task/turn orchestration
6. the agent assembles prompt context from task state, execution memory, structured memory, skills, docs, and workspace files
7. `packages/llm` sends prompts through an AI SDK-backed provider adapter
8. tool calls are executed through the batch scheduler
9. tool results, task state, memory updates, and session entries are appended
10. runtime events flow back into the TUI or print-mode output

## Main State Stores

### Machine-level state

Stored under `~/.mono`:

- `config.json`
- `local/secrets.json`
- `sessions/`
- `skills/`

### Project-level state

Stored under the current workspace:

- `.mono/memories/` for execution memory and task todo records
- `.mono/memory-v2/` for structured self / other / project / episodic memory
- `.mono/skills/` for workspace-local skill overrides and additions
- `.mono/CONTEXT.md`, `.mono/IDENTITY.md`, and `.mono/MEMORY.md` for workspace bootstrap context

## Main Components

### CLI

`packages/cli`

Responsibilities:

- command parsing
- auth/config/context/memory command handling
- choosing interactive mode vs `--print`
- loading native image attachments for one-shot and interactive runs

### TUI

`packages/tui`

Responsibilities:

- Ink UI composition
- input handling
- pending image attachment management
- dialog lifecycle
- mapping runtime events into visible state

### Agent

`packages/agent-core`

Responsibilities:

- initialize config, model, session, and memory stores
- assemble prompt context and context reports
- run tasks and turns
- validate image-bearing inputs against model capability
- verify and summarize
- write execution memory and structured memory
- emit runtime events

### LLM layer

`packages/llm`

Responsibilities:

- resolve models
- route to the correct adapter
- normalize provider interactions
- convert shared image parts into provider-specific multimodal request blocks
- schedule tool calls through the tool batch scheduler

### Tools

`packages/tools`

Responsibilities:

- filesystem and shell tools
- permission wrapping
- execution metadata such as serial vs readonly parallel mode
- image file reads when the agent uses the `read` tool on workspace images

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

- execution-memory records and retrieval helpers
- mutable task todo records
- structured memory storage, promotion, retrieval planning, and rendering
- plain-text summaries for image-bearing user turns inside memory traces and task summaries

### OpenViking adapter

`packages/openviking-adapter`

Responsibilities:

- retrieval integration for execution memory
- external retrieval augmentation for structured memory
- shadow export of execution-memory records
- shadow export of structured-memory snapshots

### SeekDB adapter

`packages/seekdb-adapter`

Responsibilities:

- evaluation adapters for SeekDB-backed execution memory
- retrieval experiments against SeekDB-backed storage
- session mirroring for migration analysis
- keeping local runtime state authoritative unless a deeper migration is explicitly chosen

## Simplified Architecture Diagram

```text
CLI / TUI
   |
   v
Agent
   |
   +--> Config
   +--> Session
   +--> Execution Memory
   +--> Structured Memory
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
- config resolution influences model selection, memory settings, prompt context, and OpenViking sync behavior

## Related Documents

- [`monorepo-structure.md`](./monorepo-structure.md)
- [`runtime-lifecycle.md`](./runtime-lifecycle.md)
- [`task-runtime.md`](./task-runtime.md)
- [`tool-execution.md`](./tool-execution.md)
- [`event-model.md`](./event-model.md)
- [`image-input.md`](./image-input.md)
- [`memory-system.md`](./memory-system.md)
- [`skills-system.md`](./skills-system.md)
- [`structured-memory-v2.md`](./structured-memory-v2.md)
- [`openviking-integration.md`](./openviking-integration.md)
- [`seekdb-integration.md`](./seekdb-integration.md)
