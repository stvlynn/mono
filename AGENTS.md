# AGENTS Guide (Index-First)

This file is the **agent-oriented index** for navigating the `mono` repository.
Use it as the first stop before scanning the whole tree.

## 1) Fast Entry Points

- Project overview for humans: [`README.md`](./README.md)
- Docs hub for agents: [`docs/index.md`](./docs/index.md)
- Technical docs map: [`docs/README.md`](./docs/README.md)

## 2) Task → Where to Read

### Understand architecture
1. [`docs/architecture/system-overview.md`](./docs/architecture/system-overview.md)
2. [`docs/architecture/task-runtime.md`](./docs/architecture/task-runtime.md)
3. [`docs/architecture/tool-execution.md`](./docs/architecture/tool-execution.md)

### Work on memory/retrieval
1. [`docs/architecture/memory-system.md`](./docs/architecture/memory-system.md)
2. [`docs/architecture/structured-memory-v2.md`](./docs/architecture/structured-memory-v2.md)
3. [`docs/architecture/openviking-integration.md`](./docs/architecture/openviking-integration.md)
4. [`docs/architecture/seekdb-integration.md`](./docs/architecture/seekdb-integration.md)

### Work on runtime surfaces
- CLI: [`docs/cli/commands.md`](./docs/cli/commands.md)
- TUI: [`docs/tui/overview.md`](./docs/tui/overview.md)
- IM platform: [`docs/im-platform/overview.md`](./docs/im-platform/overview.md)
- Telegram control: [`docs/telegram-control/overview.md`](./docs/telegram-control/overview.md)

### Check stable decisions first
- ADR index folder: [`docs/decisions/`](./docs/decisions/)

## 3) Repo Layout (high level)

- `packages/*`: source packages
- `docs/*`: maintainer and architecture docs
- `test/*`: integration and package behavior tests
- `.mono/*`: runtime identity/context/memory metadata

## 4) Working Conventions for Agents

- Prefer **Markdown docs first**, then inspect code.
- Follow the ordered paths in [`docs/index.md`](./docs/index.md) when context is unclear.
- If you change architecture or durable behavior, update docs and ADRs accordingly.
- Keep edits minimal and scoped; avoid framework-heavy docs changes.

## 5) Documentation Maintenance Checklist

When adding/changing docs:
- Update [`docs/index.md`](./docs/index.md) if navigation paths change.
- Update [`docs/README.md`](./docs/README.md) if section responsibilities change.
- Keep this file (`AGENTS.md`) aligned with new top-level navigation.
