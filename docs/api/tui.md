# API Reference: `@mono/tui`

## Purpose

Describe the maintainers' interface for the interactive UI package.

## Public Entry

`runInteractiveApp()` from `packages/tui/src/app.tsx`

## Core Layers

- `AppContainer`: state assembly and action wiring
- `JsonRenderTui`: local json-render host and render scheduler
- `tui-render-registry`: adapter-owned catalog and registry implementations
- `tui-render-runtime`: deterministic fallback spec, SpecStream validation, and overlay handling
- `presentation`: deterministic presentation-state contract for UI generation
- `useAgentBridge`: runtime-event to UI-state bridge
- dialog and input components
- interrupt controller for `Ctrl+C`
