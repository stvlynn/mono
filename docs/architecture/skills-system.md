# Skills System

## Purpose

Describe how `mono` discovers, prioritizes, renders, and installs skills.

## Scope

This document covers the current implementation only.

It does not describe future `update`, `remove`, or lockfile behavior because those features do not exist yet.

## Skill Shape

A skill is a directory containing `SKILL.md`.

Optional sibling resources may include:

- `references/`
- `scripts/`
- `assets/`

`SKILL.md` is parsed as:

- YAML frontmatter for `name` and `description`
- markdown body for the actual instructions

The current parser accepts:

- single-line `key: value` entries
- quoted string values
- block-scalar descriptions such as `description: |`

## Skill Sources

`mono` currently merges three skill sources into one visible set.

### Builtin skills

Defined in `packages/agent-core/src/builtin-skills.ts`.

Current builtin skills:

- `find-skills`
- `skill-creator`

Builtin skills use synthetic locations such as `builtin://find-skills`.

### Global skills

Loaded from `getMonoConfigPaths(cwd).globalSkillsDir`.

In the default config layout this is:

- `~/.mono/skills/`

If `MONO_CONFIG_DIR` is set, the global skills root moves with it.

### Project skills

Loaded from:

- `.mono/skills/`

inside the current workspace.

## Merge and Precedence Rules

The runtime uses `loadAvailableSkills(cwd)` from `packages/agent-core/src/skills.ts`.

It loads builtin, global, and project skills, then merges them by normalized skill name.

Normalization rules:

- trim whitespace
- lowercase
- convert spaces and underscores to `-`

Precedence is fixed:

1. project
2. global
3. builtin

Consequences:

- a project can override a globally installed skill
- a global skill can override a builtin skill with the same name
- the final visible set is deterministic

Every loaded skill now carries an `origin` field:

- `builtin`
- `global`
- `project`

## Prompt Injection

`Agent.loadSkillsContextForTaskTurn()` loads the merged visible set and passes it to `renderSkillsContext(...)`.

That renderer emits a `<ProjectSkills>` block containing:

- a list of all visible skills
- inline `<Skill ...>` blocks only for active matches

Current activation heuristics are intentionally simple:

- explicit `$skill-name` mention
- direct name mention
- normalized folder-token match

The prompt context therefore exposes the full catalog for visibility, but only injects the full body of skills that appear relevant to the current turn.

## CLI and TUI Surfaces

### CLI

The `skills` command group currently provides:

- `mono skills [query]`
- `mono skills list [query]`
- `mono skills find <query...>`
- `mono skills add <source>`

`mono skills` and `mono skills list` both read the merged visible set and print:

- name
- origin
- description
- path

### TUI

The `/skills` browser now reads the same merged visible set.

It is a read-only browser surface:

- it shows builtin, global, and project skills together
- it labels each skill with its origin
- it shows the resolved path or builtin URI when inspecting a skill

## Remote Search and Install

Remote discovery and installation live in `packages/cli/src/skills/`.

### Search

`mono skills find` calls the `skills.sh` search API.

The response is normalized into:

- display name
- source repository slug
- install count
- install source in `owner/repo@skill-name` form
- `skills.sh` URL

### Install sources

`mono skills add` currently supports:

- `owner/repo@skill-name`
- `https://github.com/owner/repo`
- `https://github.com/owner/repo/tree/<ref>`
- `https://github.com/owner/repo/tree/<ref>/<subpath>`

All of the above may include an optional `@skill-name` selector when needed.

### Install flow

The installer:

1. parses the GitHub source
2. clones the repository into a temporary directory with `git clone --depth 1`
3. searches for skills under:
   - repository root
   - `skills/`
   - `.mono/skills/`
   - `.agents/skills/`
   - an explicit tree subpath when provided
4. selects the requested skill
5. copies the full skill directory into the mono global skills root
6. writes `.mono-skill.json` metadata next to the installed files

If a repository exposes multiple skills, the installer requires `@skill-name`.

### Safety checks

The current implementation includes basic path-safety guards:

- reject `..` traversal in GitHub tree subpaths
- reject install paths that escape the destination root
- sanitize install directory names before writing under `~/.mono/skills`

## Current Limitations

The current implementation intentionally stops at the first useful feature set.

Not implemented yet:

- skill update checks
- skill removal commands
- lockfile management
- non-GitHub remote sources
- project-scoped remote installation
- agent-target multiplexing like `vercel-labs/skills`

## Related Files

- `packages/agent-core/src/skills.ts`
- `packages/agent-core/src/builtin-skills.ts`
- `packages/cli/src/skills/search.ts`
- `packages/cli/src/skills/source-parser.ts`
- `packages/cli/src/skills/install.ts`
- `packages/cli/src/commands/skills-command.ts`

## Related Documents

- [`system-overview.md`](./system-overview.md)
- [`prompt-system.md`](./prompt-system.md)
- [`../cli/commands.md`](../cli/commands.md)
- [`../cli/skills-commands.md`](../cli/skills-commands.md)
- [`../decisions/0007-skills-layering-and-precedence.md`](../decisions/0007-skills-layering-and-precedence.md)
