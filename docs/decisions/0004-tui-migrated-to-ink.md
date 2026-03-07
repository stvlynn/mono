# ADR 0004: TUI Uses Ink

## Context

The interactive UI needed a component model closer to modern terminal apps and Gemini CLI-style composition.

## Decision

Use Ink as the active TUI framework.

## Consequences

- UI state and behavior are easier to decompose into components and hooks
- raw key handling still requires custom compatibility logic
- older terminal helpers remain legacy/reference context only
