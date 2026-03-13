Long-lived project memory:

- `mono` keeps local session history under `~/.mono/sessions`
- execution memory is stored separately from session replay
- task todos are mutable task-state records, not durable architecture memory
- prompt templates live in `packages/prompts`
- project-local skills are discovered from `.mono/skills`

This file should stay concise and stable. Do not store per-task scratch notes here.
