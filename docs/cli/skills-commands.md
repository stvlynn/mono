# Skills Commands

## Current Commands

- `mono skills [query]`
- `mono skills list [query]`
- `mono skills find <query...>`
- `mono skills add <source>`

## Purpose

These commands expose the current skill catalog and the first remote-install path for `mono`.

## Visible Skill Catalog

`mono` now merges three skill scopes into one visible set:

- builtin skills shipped with `mono`
- global skills from `~/.mono/skills`
- project skills from `.mono/skills`

When names collide, precedence is:

1. project
2. global
3. builtin

Both `mono skills` and `mono skills list` print the merged catalog.

The output includes:

- skill name
- origin
- description
- resolved path

## `mono skills [query]`

This is the compatibility shortcut for listing available skills.

If a query is provided, it filters by:

- name
- description
- content
- origin

## `mono skills list [query]`

This is the explicit list subcommand for the same catalog.

Use it when scripting or when the intent should be obvious in shell history.

## `mono skills find <query...>`

Searches the remote skills registry through `skills.sh`.

The current implementation returns:

- skill name
- source repository
- install count
- canonical install command
- `skills.sh` URL

Example:

```bash
mono skills find react performance
```

Typical output shape:

```text
react-performance-optimization
  source: nickcrew/claude-ctx-plugin
  installs: 612 installs
  install: mono skills add nickcrew/claude-ctx-plugin@react-performance-optimization
  url: https://skills.sh/nickcrew/claude-ctx-plugin/react-performance-optimization
```

## `mono skills add <source>`

Installs a remote skill into the global mono skills directory.

Default target:

- `~/.mono/skills/<sanitized-skill-name>/`

Supported source formats:

- `owner/repo@skill-name`
- `https://github.com/owner/repo`
- `https://github.com/owner/repo/tree/<ref>`
- `https://github.com/owner/repo/tree/<ref>/<subpath>`

Behavior notes:

- repositories with multiple skills require `@skill-name`
- the installer copies the whole skill directory, not just `SKILL.md`
- `.mono-skill.json` is written beside the installed skill for future metadata-based operations

Example:

```bash
mono skills add nickcrew/claude-ctx-plugin@react-performance-optimization
```

## JSON Output

The command group supports JSON output for automation.

Examples:

```bash
mono skills --json
mono skills list --json
mono skills find --json react performance
mono skills --json add owner/repo@skill-name
```

## Current Boundaries

What these commands do today:

- browse local visible skills
- search the remote registry
- install one remote skill into the global mono root

What they do not do yet:

- update installed skills
- remove installed skills
- maintain a lockfile
- install directly into `.mono/skills`
- fetch from non-GitHub remote providers

## Related Documents

- [`commands.md`](./commands.md)
- [`../architecture/skills-system.md`](../architecture/skills-system.md)
