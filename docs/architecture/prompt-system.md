# Prompt System

## Purpose

Describe how prompts and prompt-like text are managed.

## Centralization

`mono` centralizes prompt templates in `@mono/prompts`.

This includes:

- LLM-facing system prompts
- memory context blocks
- compactor text fragments
- TUI waiting-copy templates

## Template Engine

Templates use Nunjucks with Jinja-style syntax.

## Registry and Rendering

Key files:

- `packages/prompts/src/registry.ts`
- `packages/prompts/src/render.ts`
- `packages/prompts/src/templates/`

## Build Assets

Templates are copied into build output during the root build.

This is required because TypeScript compilation alone does not ship `.j2` files.

## Current Separation

- `agent-core` consumes system prompts
- `memory` consumes memory/compactor templates
- `tui` consumes waiting-copy templates
