# Monorepo Structure

## Purpose

Describe package boundaries and dependency direction.

## Package Layers

### Foundation

- `@mono/shared`

Shared types and filesystem/runtime helpers used across nearly every package.

### Configuration and storage

- `@mono/config`
- `@mono/session`
- `@mono/memory`
- `@mono/prompts`

These packages own persistent state or reusable assets.

### Execution

- `@mono/tools`
- `@mono/llm`
- `@mono/agent-core`

These packages execute the runtime: tools, model calls, task orchestration.

### Interfaces

- `@mono/tui`
- `@mono/cli`

These packages expose the runtime to users.

## Practical Dependency Direction

The intended direction is:

```text
shared
  -> config/session/memory/prompts/tools
  -> llm/agent-core
  -> tui/cli
```

## Notes on `@mono/pi-tui`

`@mono/pi-tui` remains in the workspace as legacy/reference context. The active UI path is `@mono/tui`.

## Build Graph

The workspace uses TypeScript project references. Prompt templates are copied as build assets after compilation.
