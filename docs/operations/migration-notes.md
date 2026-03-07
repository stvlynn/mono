# Migration Notes

## Relevant Historical Shifts

- machine config was standardized on `~/.mono`
- task todos moved from hard-coded runtime state to memory-backed records
- prompts were centralized in `@mono/prompts`
- the active TUI moved to Ink-based composition
- readonly tool batches can now execute in parallel

## Why This Matters

When debugging old sessions, tests, or assumptions, check whether the behavior predates one of these changes.
