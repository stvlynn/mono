# Interactive vs Print Mode

## Interactive Mode

Interactive mode launches the Ink TUI and keeps session/task state visible while the agent runs.

## Print Mode

Print mode runs a single task and exits.

Behavior:

- assistant text deltas stream to stdout
- task/tool status events stream to stderr
- useful for scripting and smoke checks
