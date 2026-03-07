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
