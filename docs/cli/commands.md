# CLI Commands

## Main Entry

`mono [options] [prompt...]`

## Command Groups

- `auth`
- `config`
- `context`
- `models`
- `memory`
- `pair`
- `skills`
- `telegram`

## Modes

- interactive TUI mode
- `--print` one-shot mode
- `--continue` session resume mode
- `--image <path>` native image input in both interactive and print flows

## Main Options

- `--print`: run once and stream output to stdout/stderr
- `--model <selection>`: override the configured model
- `--profile <name>`: choose a configured profile
- `--base-url <url>`: override provider base URL
- `--image <path>`: attach a local image; may be repeated
- `--continue`: reopen the latest session for the current workspace

## Image Input

Current behavior:

- print mode accepts text, images, or both
- interactive mode preloads `--image` attachments into the TUI composer
- if a prompt is also provided, the TUI submits it immediately with the preloaded images
- local image paths are normalized before the agent run starts

The agent runtime still receives a generic `TaskInput`; the CLI does not construct provider-specific payloads itself.

## Notes

- `context` inspects assembled prompt context, not stored memory records
- `memory` inspects execution-memory status and adapter state, and now also reports `memory-v2` configuration
- `pair telegram` approves Telegram pairing codes or directly writes Telegram DM allowlist entries
- `skills` now covers both local catalog browsing and remote skill search/install
- `telegram` manages Telegram control runtime configuration (`status`, `token`, `enable`, `disable`)
- image input is validated before task execution and rejected when the selected model does not support attachments

## Detailed Command Docs

- [`memory-commands.md`](./memory-commands.md)
- [`skills-commands.md`](./skills-commands.md)
