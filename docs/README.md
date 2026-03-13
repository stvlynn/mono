# mono Technical Documentation

This directory is the contributor and maintainer documentation set for `mono`.

## Audience

These docs are written for engineers working inside the monorepo:

- contributors adding features or fixing bugs
- maintainers debugging runtime behavior
- future agents or engineers extending the CLI, TUI, task runtime, storage layers, or retrieval adapters

The root [`README.md`](../README.md) stays intentionally lightweight. The detailed technical material lives here.

## Directory Map

- [`getting-started/`](./getting-started/repo-overview.md): repo orientation, local development, test/build flow
- [`architecture/`](./architecture/system-overview.md): runtime model, subsystem boundaries, data flow, invariants
- `architecture/image-input.md`: native image input contracts, CLI/TUI entrypoints, and platform inbound normalization
- `architecture/skills-system.md`: skill discovery, precedence, prompt injection, and remote install behavior
- [`im-platform/`](./im-platform/overview.md): IM dispatch subsystem, provider abstraction, Telegram mapping, and extension rules
- [`telegram-control/`](./telegram-control/overview.md): Telegram pairing runtime, allowlist state, and CLI/TUI control commands
- `architecture/memory-system.md`: authoritative memory-layer overview
- `architecture/structured-memory-v2.md`: structured-memory storage, promotion, retrieval, and prompt injection
- `architecture/openviking-integration.md`: hybrid OpenViking retrieval and shadow-sync boundary
- `architecture/seekdb-integration.md`: SeekDB evaluation path for execution memory and session mirroring
- [`api/`](./api/agent-core.md): maintainer-facing package and interface references
- `api/structured-memory.md`: `memory-v2` store, pipeline, retrieval, and renderer APIs
- [`tui/`](./tui/overview.md): interactive UI architecture, keybindings, dialogs, interrupts, waiting copy
- [`cli/`](./cli/commands.md): command groups, config/auth flows, context inspection, and memory surfaces
- `cli/skills-commands.md`: local skill browsing and remote skill search/install
- [`operations/`](./operations/troubleshooting.md): troubleshooting, debugging, compatibility, migration notes
- [`decisions/`](./decisions/0001-config-home-is-dot-mono.md): short ADRs for durable architectural choices

## Recommended Reading Order

1. [`getting-started/repo-overview.md`](./getting-started/repo-overview.md)
2. [`architecture/system-overview.md`](./architecture/system-overview.md)
3. [`im-platform/overview.md`](./im-platform/overview.md)
4. [`telegram-control/overview.md`](./telegram-control/overview.md)
5. [`architecture/image-input.md`](./architecture/image-input.md)
6. [`architecture/memory-system.md`](./architecture/memory-system.md)
7. [`architecture/structured-memory-v2.md`](./architecture/structured-memory-v2.md)
8. [`architecture/openviking-integration.md`](./architecture/openviking-integration.md)
9. [`architecture/task-runtime.md`](./architecture/task-runtime.md)
10. [`architecture/tool-execution.md`](./architecture/tool-execution.md)
11. [`cli/commands.md`](./cli/commands.md)
12. [`architecture/skills-system.md`](./architecture/skills-system.md)

## Writing Rules

When extending this doc set:

- describe the current implementation first
- separate facts from future work
- link to concrete package paths and source files
- keep API docs focused on cross-package contracts, not symbol dumps
- add an ADR when a change alters a long-lived architectural decision

## Documentation Roadmap

The current doc set covers:

- the IM dispatch subsystem and Telegram provider boundary
- the Telegram control runtime, pairing store, and operator command surface
- native image input across CLI, TUI, and platform providers
- monorepo structure and dependency direction
- task runtime and memory-backed todo planning
- execution memory, structured memory, and prompt context assembly
- builtin, global, and project skill discovery plus remote skill installation
- OpenViking and SeekDB integration boundaries
- Ink TUI architecture, dialog model, and interrupt behavior
- CLI command surfaces, config resolution, and troubleshooting
