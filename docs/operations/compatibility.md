# Compatibility Notes

## Provider Compatibility

Current LLM support is centered on OpenAI-compatible `xsai` transports.

Important note:
- Anthropic support in this repo is routed through an OpenAI-compatible endpoint path, not native Anthropic protocol support.

## Terminal Compatibility

The TUI relies on raw key parsing for several important behaviors:

- backspace/delete compatibility
- newline handling
- `Ctrl+C` interrupt behavior

Real TTY validation is still required across different terminals.

## OpenViking Compatibility

OpenViking integration is optional and currently aimed at evaluation.

Compatibility assumptions:

- `mono` remains the owner of local session replay and task todo state
- OpenViking is treated as an external retrieval/context system
- failure to reach OpenViking should not make the local runtime unusable

Operational caveat:

- OpenViking introduces a second runtime stack and external service boundary, so local debugging becomes more complex than the default filesystem-backed mode

## SeekDB Compatibility

SeekDB integration is optional and currently scoped to evaluation.

Compatibility assumptions:

- execution memory is the primary migration candidate
- session integration is limited to mirroring or experimental backends
- task todo memory remains local

Operational caveats:

- `mysql` mode is the preferred path for the current Node/TypeScript runtime
- `python-embedded` mode introduces a second runtime stack and more process-management risk
- local JSON and JSONL remain easier to inspect by hand than a database-backed evaluation path
