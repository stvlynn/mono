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

## 5) Recent Changes Log

### 2026-03-22: Web Config Real Backend Integration

**Changes made to `packages/web-config/` and runtime surfaces:**
- Added `mono config ui` to serve the web config UI through the CLI
- Connected the UI to real `~/.mono/config.json` and `~/.mono/local/secrets.json` backends
- Added hash-guarded global config saves, redacted Telegram bot-token round trips, and profile-local secret management
- Expanded the UI to cover settings, memory, context, Telegram, skills, and raw JSON editing
- Added a config-ui reload signal so idle TUI sessions can refresh registry/runtime state after web edits
- Added Docker service support for serving the config UI

**Files modified:**
- `packages/cli/src/commands/config-commands.ts`
- `packages/cli/src/config-ui/`
- `packages/config/src/config-ui.ts`
- `packages/config/src/resolver.ts`
- `packages/tui/src/AppContainer.tsx`
- `packages/web-config/src/`
- `docker-compose.yml`
- `docs/cli/commands.md`
- `docs/operations/docker.md`

### 2026-03-22: Web Config UX Hardening

**Changes made to `packages/web-config/`:**
- Reworked navigation into a responsive mobile drawer plus desktop sidebar
- Connected theme settings to the document root with system theme support
- Added labels, focus rings, and keyboard affordances to custom controls
- Increased interactive control sizes to meet the documented 44x44 touch target minimum
- Corrected provider-specific profile metadata shown in cards

**Files modified:**
- `src/App.tsx`
- `src/components/sections/ProfilesSection.tsx`
- `src/components/sections/MemorySection.tsx`
- `src/components/sections/SafetySection.tsx`
- `src/components/sections/SkillsSection.tsx`
- `src/components/sections/GeneralSection.tsx`
- `src/components/ui/button.tsx`
- `src/components/ui/input.tsx`
- `src/index.css`
- `README.md`

### 2025-03-22: Web Config UI Improvements

**Changes made to `packages/web-config/`:**
- Fixed missing `type="button"` attributes on interactive buttons
- Added `aria-label="Delete profile"` to icon-only delete button for accessibility
- Added `cursor-pointer` class to custom interactive elements
- Added `prefers-reduced-motion` media query support for accessibility

**Files modified:**
- `src/components/sections/ProfilesSection.tsx`
- `src/components/sections/MemorySection.tsx`
- `src/index.css`

See `packages/web-config/README.md` for usage instructions.

## 6) Documentation Maintenance Checklist

When adding/changing docs:
- Update [`docs/index.md`](./docs/index.md) if navigation paths change.
- Update [`docs/README.md`](./docs/README.md) if section responsibilities change.
- Update this **Recent Changes Log** section for significant modifications.
- Keep this file (`AGENTS.md`) aligned with new top-level navigation.
