# Repo Overview

## Purpose

This document explains what lives in the `mono` monorepo and where to start when debugging or extending it.

## Audience

- contributors new to the repository
- maintainers mapping a bug to the correct package

## Scope

This is a package-level overview, not a runtime walkthrough.

## What `mono` Is

`mono` is a coding agent CLI built around:

- an LLM execution layer backed by the Vercel AI SDK
- a task runtime with memory-backed todo planning
- protected coding tools (`read`, `write`, `edit`, `bash`)
- a tree-shaped JSONL session store
- an Ink-based terminal UI

## Package Responsibilities

### Core runtime packages

- `packages/agent-core`: orchestrates tasks, turns, verification, memory injection, session updates, and approvals
- `packages/llm`: model registry and adapter/router layer for AI SDK-backed multi-provider execution
- `packages/tools`: built-in tools and permission wrapping
- `packages/session`: append-only session storage, branch heads, replay, summaries, and compression entries
- `packages/memory`: execution memory store, retrieval, compaction, and task todo store

### Shared and configuration packages

- `packages/shared`: shared types, JSON/file helpers, path helpers, runtime primitives
- `packages/config`: `~/.mono` layout, config read/write, config resolution, migration logic
- `packages/prompts`: Nunjucks templates for LLM-facing prompts and UI waiting-copy text
- `packages/im-platform`: outbound IM dispatch abstraction and Telegram send adapter
- `packages/telegram-control`: Telegram pairing runtime, allowlist store, and operator control commands

### User-facing packages

- `packages/tui`: interactive Ink UI, state bridge, dialogs, input handling, slash command integration
- `packages/cli`: `mono` command entrypoint, auth/config/memory commands, interactive/bootstrap logic

### Legacy/compat context

- `packages/pi-tui`: earlier terminal rendering/runtime helpers retained for reference or compatibility context; the active interactive UI is `@mono/tui`

## Where To Start By Problem Type

- provider/model/config issue: `packages/config`, `packages/llm`
- task planning or verification issue: `packages/agent-core/src/task-runtime.ts`
- prompt rendering issue: `packages/prompts`, `packages/agent-core/src/system-prompt.ts`
- tool execution issue: `packages/tools`, `packages/llm/src/adapters/tool-batch-scheduler.ts`
- session replay or branch issue: `packages/session/src/session-manager.ts`
- memory recall or todo persistence issue: `packages/memory`, `packages/agent-core/src/memory-runtime.ts`
- interactive UI or key handling issue: `packages/tui/src/AppContainer.tsx`, `packages/tui/src/components/`, `packages/tui/src/hooks/`

## Dependency Direction

At a high level:

- `shared` sits at the bottom
- `config`, `session`, `memory`, `tools`, and `prompts` build on `shared`
- `llm` and `agent-core` depend on those subsystems
- `tui` and `cli` sit on top of `agent-core`

For a runtime walkthrough, continue to [`../architecture/system-overview.md`](../architecture/system-overview.md).
