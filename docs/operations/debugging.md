# Debugging Guide

## First Places To Inspect

- `packages/agent-core/src/agent.ts`
- `packages/agent-core/src/task-runtime.ts`
- `packages/llm/src/adapters/tool-batch-scheduler.ts`
- `packages/tui/src/AppContainer.tsx`
- `packages/session/src/session-manager.ts`

## Useful Runtime Checks

- `mono --print ...`
- `pnpm test`
- inspect `.mono/memories/`
- inspect `~/.mono/sessions/`

## Debugging Philosophy

Start at the package boundary where the contract seems broken:

- config/model selection
- task state
- tool execution
- session persistence
- UI event projection
