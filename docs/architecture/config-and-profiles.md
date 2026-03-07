# Config and Profiles

## Purpose

Document config layout, profile resolution, and precedence.

## Primary Config Home

`mono` stores machine-level state in `~/.mono`.

Important paths:

- `config.json`
- `local/secrets.json`
- `sessions/`
- cache/state/rules/skills/settings directories

## Config Resolution

`packages/config/src/resolver.ts` resolves config from:

1. CLI overrides
2. environment variables
3. project config
4. global config
5. legacy compatibility paths if still present
6. builtin defaults

## Profiles

Profiles choose:

- provider
- model id
- base URL
- provider factory
- API key source
- memory settings inheritance

## API Keys

API keys may come from:

- `MONO_API_KEY`
- `~/.mono/local/secrets.json`
- provider-specific env vars such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `MOONSHOT_API_KEY`
- legacy compatibility sources
