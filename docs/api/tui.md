# API Reference: `@mono/tui`

## Purpose

Describe the maintainers' interface for the interactive UI package.

## Public Entry

`runInteractiveApp()` from `packages/tui/src/app.tsx`

## Core Layers

- `AppContainer`: state assembly and action wiring
- `RootApp`: top-level layout
- `useAgentBridge`: runtime-event to UI-state bridge
- dialog and input components
- interrupt controller for `Ctrl+C`
