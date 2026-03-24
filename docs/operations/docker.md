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
- `MONO_BOOTSTRAP_PROVIDER` (`openai`, `openrouter`, `anthropic`, `google`/`gemini`)
- `MONO_BOOTSTRAP_MODEL`
- optional `MONO_BOOTSTRAP_BASE_URL`

On startup, the entrypoint will create a default profile if `config.json` does not already exist in the mounted config directory.


## Telegram channel bootstrap

To bring Telegram channel capability online at container startup, set:

- `MONO_TELEGRAM_ENABLED=1`
- `MONO_TELEGRAM_BOT_TOKEN=<your_bot_token>`
- optional `MONO_TELEGRAM_BOT_ID=<bot_user_id>`
- optional `MONO_TELEGRAM_DM_POLICY=pairing|allowlist|open|disabled`

These values are written into `mono.channels.telegram` during first-boot bootstrap.

## Run

```bash
docker compose up -d
```

The default compose file mounts:

- the repository into `/workspace`
- `${HOME}/.mono` into `/data/home/.mono`

That means the container uses:

- machine-level config from the host `~/.mono`
- project-level overrides from the mounted repository `.mono/config.json`

If the container appears to ignore a new default profile, check whether the project config still pins `mono.profile`.

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
docker compose run --rm mono --help
docker compose run --rm mono --print hello
```

## Web Config UI

The compose file also includes a dedicated `mono-config-ui` service that runs:

```bash
mono config ui --host 0.0.0.0 --port 5173 --no-open
```

Start it with:

```bash
docker compose up -d mono-config-ui
```

Then open:

```text
http://127.0.0.1:${MONO_CONFIG_UI_PORT:-5173}
```

The UI container mounts the same host `~/.mono` volume as the main `mono` service, so edits go to the real global config and secrets files.

Current compose/runtime behavior:

- the container still ships a built `/app` image
- the compose file mounts the repository into `/workspace`
- the mounted `./docker` directory is also mounted into `/app/docker`
- when `/workspace` contains the repo, the entrypoint runs `tsx packages/cli/src/bin.ts` from `/workspace`
- this means source changes in the mounted workspace take effect after `docker compose restart` without rebuilding the image

## Secrets

Do not bake API keys into the image.

Recommended options:

- reuse an existing host `~/.mono` directory
- provide provider keys as environment variables when needed

Operational note:

- `MONO_API_KEY=""` should be treated as unset
- if a wrapper or environment manager injects an empty string, verify the resolved key source from inside the container with:

```bash
docker compose exec -T mono -- auth status
```

## Notes

Some control-plane features are still tied to the interactive TUI process. This Docker setup gives a persistent container baseline, not a fully separated background daemon architecture.
