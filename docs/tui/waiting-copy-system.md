# Waiting Copy System

## Purpose

Document the UI waiting-text system used while the agent is thinking, streaming, verifying, or running tools.

## Source of Text

Waiting copy is template-backed and generated from the prompt template set under `packages/prompts/src/templates/ui/`.

## State Model

The TUI stores one active `waitingCopy` in UI state and reuses it across visible status regions.

## Priority

Current display preference is:

1. interrupt hint
2. waiting copy
3. normal status
