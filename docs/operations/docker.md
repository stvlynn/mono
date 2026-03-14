# Docker

This repository can run inside Docker with a persistent `~/.mono` config volume.

## What persists

The container keeps machine-level agent state in `MONO_CONFIG_DIR`, which defaults to `/data/home/.mono` inside the container.

Persist this directory to keep:

- `config.json`
- `local/secrets.json`
- `sessions/`
- `memories/`
- `cache/`
- `state/`
- `skills/`
- `settings/`

## Build

```bash
docker compose build
```

## Bootstrap config from environment

Copy `.env.example` to `.env` when you want the container to create a usable `~/.mono/config.json` on first boot.

```bash
cp .env.example .env
```

Fill in at least:

- `MONO_API_KEY`
- `MONO_BOOTSTRAP_PROVIDER`
- `MONO_BOOTSTRAP_MODEL`
- optional `MONO_BOOTSTRAP_BASE_URL`

On startup, the entrypoint will create a default profile if `config.json` does not already exist in the mounted config directory.

## Run

```bash
docker compose up -d
```

The default compose file mounts:

- the repository into `/workspace`
- `${HOME}/.mono` into `/data/home/.mono`

If you want a different host config directory, override `MONO_CONFIG_DIR_HOST`:

```bash
MONO_CONFIG_DIR_HOST=/path/to/mono-config docker compose up -d
```

## Attach to the running TUI

```bash
docker attach $(docker compose ps -q mono)
```

Detach without stopping the container with `Ctrl-p` followed by `Ctrl-q`.

## One-shot commands

```bash
docker compose run --rm mono "node /app/packages/cli/dist/bin.js --help"
docker compose run --rm mono "node /app/packages/cli/dist/bin.js --print hello"
```

## Secrets

Do not bake API keys into the image.

Recommended options:

- reuse an existing host `~/.mono` directory
- provide provider keys as environment variables when needed

## Notes

Some control-plane features are still tied to the interactive TUI process. This Docker setup gives a persistent container baseline, not a fully separated background daemon architecture.
