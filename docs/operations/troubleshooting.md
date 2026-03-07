# Troubleshooting

## Missing API Key

Symptoms:

- provider-specific missing API key errors
- TUI starts, but first task fails immediately

Checks:

- `mono auth status`
- `mono config list`
- provider env vars such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `MOONSHOT_API_KEY`

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
