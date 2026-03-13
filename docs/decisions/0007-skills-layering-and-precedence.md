# ADR 0007: Skills Layering and Precedence

## Context

`mono` originally treated skills as project-local files under `.mono/skills`.

After adding remote discovery and installation, a global skills directory became necessary. Builtin system skills also needed a first-class place in the runtime so features like `find-skills` and `skill-creator` did not depend on user-managed files.

`vercel-labs/skills` uses a broader multi-agent installation model, but `mono` does not need a shared `.agents/skills` canonical directory or agent fan-out layer.

## Decision

`mono` will treat three roots as authoritative skill sources:

1. builtin skills defined in `agent-core`
2. global skills under `~/.mono/skills`
3. project skills under `.mono/skills`

The runtime merges them by normalized skill name with this precedence:

1. project
2. global
3. builtin

Remote installs land in the mono global skills root by default.

`mono` will not introduce a separate universal skills root, agent-target registry, or lockfile in this first version.

## Consequences

- globally installed skills become visible to the CLI, TUI, and prompt assembly without extra sync steps
- projects can override a global or builtin skill intentionally
- builtin product skills can ship with the runtime and still be overridden locally when needed
- the architecture stays aligned with `mono`'s own config layout under `~/.mono` and `.mono`
- update, remove, and version-tracking behavior remains future work and must build on the current metadata file approach
