# Prompt Template Migration Archive

## Purpose

This document archives the migration that removed hardcoded LLM-facing prompt text from runtime code and moved it into Jinja/Nunjucks templates.

The migration has two scopes:

- shared agent/runtime prompt fragments now live under `@mono/prompts`
- platform-specific prompt fragments now live beside the owning platform adapter/provider

This is an implementation archive for maintainers. Read it when debugging prompt behavior, changing task/runtime wording, or extending another platform with its own prompt fragments.

## What Changed

### Shared prompt migration

The following prompt families were moved out of TypeScript string assembly and into shared `.j2` templates:

- task turn prompts for `verify`, `curiosity`, `direct response`, and `execute`
- task context blocks for default runs, preview, curiosity mode, and `channel_chat`
- channel delivery guidance, channel platform context, required native-action notices, and retry feedback
- autonomy heartbeat extra context

These now render through `@mono/prompts` instead of inline string arrays.

### Platform-local prompt migration

Telegram-specific prompt fragments were moved out of `packages/telegram-control/src/runtime.ts` and into local templates owned by the Telegram runtime package.

This currently covers:

- Telegram reply formatting rules
- Telegram-specific channel notes injected into channel capability context

The runtime still uses the shared Jinja renderer, but the template files stay local to the platform package.

### Rendering support

`@mono/prompts` still owns the shared template registry for centrally-managed templates.

It now also exposes a file-path-based renderer so platform packages can render local `.j2` files without duplicating templating infrastructure.

### Build asset changes

The build asset copy step now copies Telegram local templates into `packages/telegram-control/dist/templates` in addition to the shared `packages/prompts/dist/templates` tree.

This keeps packaged and containerized builds aligned with local development behavior.

## Important File Paths

### Shared renderer and registry

- `packages/prompts/src/render.ts`
- `packages/prompts/src/registry.ts`
- `packages/prompts/src/types.ts`
- `packages/prompts/src/templates/agent/`

### Shared agent/runtime prompt call sites

- `packages/agent-core/src/task-runtime.ts`
- `packages/agent-core/src/agent.ts`
- `packages/agent-core/src/autonomy-runtime.ts`

### Telegram platform-local prompt files

- `packages/telegram-control/src/runtime.ts`
- `packages/telegram-control/src/templates/reply_format_rules.j2`
- `packages/telegram-control/src/templates/channel_notes.j2`

### Build and packaging

- `scripts/copy-workspace-assets.mjs`
- `packages/prompts/dist/templates/`
- `packages/telegram-control/dist/templates/`

### Supporting docs updated during the migration

- `docs/architecture/prompt-system.md`
- `docs/api/agent-core.md`
- `docs/telegram-control/overview.md`
- `docs/getting-started/testing-and-build.md`

## Current Rules

When adding or changing prompt text:

- put shared runtime wording in `packages/prompts/src/templates/`
- keep platform-specific prompt fragments inside the owning adapter/provider package
- render both shared and platform-local templates through the shared Jinja/Nunjucks utility from `@mono/prompts`
- update the asset copy step if a package adds new runtime template directories

Avoid reintroducing hardcoded multi-line prompt text in runtime code unless the text is trivial and not LLM-facing.

## Validation Performed

The migration was validated with:

- focused `task-runtime` tests
- focused `agent` prompt-assembly tests
- focused Telegram runtime context tests
- workspace `typecheck`
- workspace `build`

Known environment note:

- the full `test/telegram-runtime.test.ts` suite may still hit a Node heap OOM in this environment; focused Telegram checks passed during the migration
