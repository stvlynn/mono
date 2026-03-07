# mono

`xsai`-powered coding agent CLI with `read`, `write`, `edit`, and `bash` tools.

## Packages

- `@mono/shared`: shared types and utilities
- `@mono/config`: `~/.mono` configuration and migration logic
- `@mono/llm`: model registry and `xsai` adapter
- `@mono/tools`: built-in coding tools and permission policies
- `@mono/session`: tree-shaped JSONL session store
- `@mono/agent-core`: agent runtime
- `@mono/tui`: Ink interactive UI
- `@mono/cli`: command-line entrypoint

## Usage

```bash
pnpm install
mono auth login
pnpm dev
mono
```

## Config

`mono` stores machine-level configuration in `~/.mono/`:

- `config.json`: profiles, defaults, project bindings
- `local/secrets.json`: local API keys
- `sessions/`: session history

Useful commands:

```bash
mono auth login
mono auth status
mono config init
mono config migrate
mono config list
```

## Documentation

Contributor and maintainer docs live under [`docs/`](./docs/README.md).
