# Migration Notes

## Relevant Historical Shifts

- machine config was standardized on `~/.mono`
- task todos moved from hard-coded runtime state to memory-backed records
- prompts were centralized in `@mono/prompts`
- shared and platform-local LLM prompts were migrated out of runtime string assembly into Jinja templates
- the active TUI moved to Ink-based composition
- readonly tool batches can now execute in parallel

## Related Archives

- [`prompt-template-migration.md`](./prompt-template-migration.md): shared prompt-template extraction plus platform-local Telegram prompt templates

## Why This Matters

When debugging old sessions, tests, or assumptions, check whether the behavior predates one of these changes.
