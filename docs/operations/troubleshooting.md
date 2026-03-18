# Troubleshooting

## Missing API Key

Symptoms:

- provider-specific missing API key errors
- TUI starts, but first task fails immediately

Checks:

- `mono auth status`
- `mono config list`
- provider env vars such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `MOONSHOT_API_KEY`
- verify whether the active profile uses `apiKeyRef` and that `~/.mono/local/secrets.json` contains the expected profile entry
- when running in Docker, verify from inside the container:
  - `docker compose exec -T mono -- auth status`
- check whether `.mono/config.json` in the project overrides the global default profile
- blank env vars such as `MONO_API_KEY=` should be treated as unset; if a container or wrapper injects empty strings, re-check the resolved `API key source`

Common Telegram-specific symptoms:

- Telegram profile save says it succeeded, but the next message fails with missing API key
  - verify the runtime is using the intended profile, not a project-level override
  - verify the profile still exists and was not removed in a concurrent Telegram action
  - if the failure only appears in Telegram chat handoff clones, inspect whether the shared session metadata header still points at an older model/provider
  - current handoff clones switch into the shared session with `preserveCurrentModel`, specifically to avoid an old session header overriding the active Telegram profile/model

## Telegram Button Errors

Symptoms:

- Telegram control replies fail with `BUTTON_DATA_INVALID`
- menu or second-step profile actions do not appear after tapping a button

Checks:

- verify callback payloads stay within Telegram limits
- prefer short opaque callback ids over embedding full profile names or long session ids
- confirm the running container/image includes the latest Telegram model-menu code

## Provider 400 Errors Around Tool Calls

Symptoms:

- provider rejects tool call/result history
- request mentions missing or invalid `tool_call_id`

Checks:

- inspect recent session entries
- inspect session compression behavior
- confirm assistant tool calls and tool result messages still align

## TUI Feels Stuck

Checks:

- verify whether the task is actually blocked, not hung
- inspect status, task phase, and loop-detected messages
- test `Ctrl+C` interrupt behavior manually in a real TTY

## Session or Branch Mismatch

Checks:

- current session id and branch head in the footer
- `mono --continue`
- session JSONL entries under `~/.mono/sessions/`
