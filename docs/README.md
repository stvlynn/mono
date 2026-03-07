# mono Technical Documentation

This directory is the contributor and maintainer documentation set for `mono`.

## Audience

These docs are written for engineers working inside the monorepo:

- contributors adding features or fixing bugs
- maintainers debugging runtime behavior
- future agents or engineers extending the CLI, TUI, task runtime, or storage layers

The root [`README.md`](../README.md) stays intentionally lightweight. The detailed technical material lives here.

## Directory Map

- [`getting-started/`](./getting-started/repo-overview.md): repo orientation, local development, test/build flow
- [`architecture/`](./architecture/system-overview.md): runtime model, subsystem boundaries, data flow, invariants
- `architecture/openviking-integration.md`: OpenViking evaluation path, current adapter boundary, migration risks
- `architecture/seekdb-integration.md`: SeekDB evaluation path for execution memory and session mirroring
- [`api/`](./api/agent-core.md): maintainer-facing package and interface references
- [`tui/`](./tui/overview.md): interactive UI architecture, keybindings, dialogs, interrupts, waiting copy
- [`cli/`](./cli/commands.md): command groups, config/auth flows, print vs interactive behavior
- [`operations/`](./operations/troubleshooting.md): troubleshooting, debugging, compatibility, migration notes
- [`decisions/`](./decisions/0001-config-home-is-dot-mono.md): short ADRs for durable architectural choices

## Recommended Reading Order

1. [`getting-started/repo-overview.md`](./getting-started/repo-overview.md)
2. [`architecture/system-overview.md`](./architecture/system-overview.md)
3. [`architecture/task-runtime.md`](./architecture/task-runtime.md)
4. [`architecture/tool-execution.md`](./architecture/tool-execution.md)
5. [`architecture/session-and-branching.md`](./architecture/session-and-branching.md)
6. [`tui/overview.md`](./tui/overview.md)
7. [`cli/commands.md`](./cli/commands.md)

## Writing Rules

When extending this doc set:

- describe the current implementation first
- separate facts from future work
- link to concrete package paths and source files
- keep API docs focused on cross-package contracts, not symbol dumps
- add an ADR when a change alters a long-lived architectural decision

## Documentation Roadmap

The first pass of this documentation set covers:

- monorepo structure and dependency direction
- task runtime and memory-backed todo planning
- tool execution, permissions, and readonly parallel batches
- session storage, branch switching, and compression
- prompt templating and UI waiting-copy generation
- Ink TUI architecture, dialog model, and interrupt behavior
- CLI command surfaces, config resolution, and troubleshooting

The next likely expansions are:

- manual TTY validation playbooks for the TUI
- richer provider compatibility notes as more adapters are added
- generated schema references for high-value shared types
