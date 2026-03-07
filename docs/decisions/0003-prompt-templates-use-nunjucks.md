# ADR 0003: Prompt Templates Use Nunjucks

## Context

Prompt text and prompt-like blocks were scattered across code and needed to be centralized.

## Decision

Use Nunjucks/Jinja-style templates in `@mono/prompts`.

## Consequences

- prompt text is decoupled from business logic
- build must copy template assets
- both runtime prompts and UI waiting copy share one template system
