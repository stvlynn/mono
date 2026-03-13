# Prompt System

## Purpose

Describe how prompts and prompt-like text are managed.

## Centralization

`mono` centralizes prompt templates in `@mono/prompts`.

This includes:

- LLM-facing system prompts
- execution-memory context blocks
- structured-memory context blocks
- compactor text fragments
- TUI waiting-copy templates

## Template Engine

Templates use Nunjucks with Jinja-style syntax.

## Registry and Rendering

Key files:

- `packages/prompts/src/registry.ts`
- `packages/prompts/src/render.ts`
- `packages/prompts/src/templates/`

Relevant memory templates now include:

- `memory/context_block`
- `memory/structured_context_block`
- `memory/openviking_context_block`
- `memory/seekdb_context_block`

## Build Assets

Templates are copied into build output during the root build.

This is required because TypeScript compilation alone does not ship `.j2` files.

## Current Separation

- `agent-core` consumes system prompts and context assembly
- `memory` consumes execution-memory, structured-memory, and compactor templates
- `tui` consumes waiting-copy templates

## Context Assembly

`packages/agent-core/src/context-assembly.ts` now assembles prompt sections for:

- operator identity
- project identity
- runtime
- task state
- memory
- skills
- docs
- project bootstrap files

The memory portion of that assembly may combine:

- execution-memory recall
- structured-memory packages
- OpenViking external retrieval items folded into the structured package

## Related Documents

- [`memory-system.md`](./memory-system.md)
- [`structured-memory-v2.md`](./structured-memory-v2.md)
