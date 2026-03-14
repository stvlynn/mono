# Telegram Control Overview

## Purpose

This document describes the current `@mono/telegram-control` implementation.

The package adds a small Telegram control-plane runtime on top of `mono`'s existing CLI and TUI. It is responsible for Telegram bot configuration, inbound DM pairing, local allowlist persistence, and Telegram-specific control commands.

It is intentionally separate from `@mono/im-platform`.

- `@mono/im-platform` owns outbound dispatch abstraction and Telegram send mapping.
- `@mono/telegram-control` owns inbound polling, pairing state, config-driven authorization, and pair/help command handling.

## Audience

- maintainers extending Telegram support in `mono`
- engineers debugging Telegram pairing or allowlist behavior
- contributors adding more control-plane commands or broadening inbound Telegram support

## Current Position

`@mono/telegram-control` is a standalone workspace package under `packages/telegram-control`.

Today it owns:

- Telegram config read/write helpers
- pending pairing request storage
- approved Telegram DM allowlist storage
- `/pair telegram ...` command execution
- `/telegram ...` command execution
- inbound Telegram command parsing for `/help` and `/pair`
- a polling runtime that starts from the TUI and listens for Telegram messages

It does not currently own:

- general-purpose Telegram chat replies from the coding agent
- webhook mode
- background daemon/service management outside the TUI process
- persistent group conversation routing
- a web control panel

The current runtime is control-oriented, not a full Telegram chat assistant.

## Package Surface

The package root is `packages/telegram-control/src/index.ts`.

Main exports:

- config helpers from `config.ts`
- pair and Telegram command handlers from `commands.ts`
- help text builders from `help.ts`
- inbound Telegram message processing from `inbound.ts`
- outbound notifier helpers from `outbound.ts`
- pairing store accessors from `pairing-store.ts`
- polling runtime from `runtime.ts`

Main public concepts:

- `TelegramControlRuntime`
- `TelegramPairingRequest`
- `TelegramPairingApproval`
- `TelegramCommandResult`
- `TelegramControlEvent`

## Config Model

Telegram config is now part of the main `mono` config surface under:

- `mono.channels.telegram`

The resolved config shape is:

- `enabled`
- `botToken`
- `botId`
- `allowFrom`
- `groupAllowFrom`
- `groups`
- `dmPolicy`
- `pollingTimeoutSeconds`

Default behavior:

- Telegram is disabled by default
- DM policy defaults to `pairing`
- the runtime polls with a 20 second Bot API timeout

Validation rules enforced during config resolution:

- `mono.channels.telegram.enabled=true` requires `botToken`
- the token must look like a Bot API token
- `botId`, when present, must be a positive numeric Telegram user id
- `dmPolicy="allowlist"` requires at least one `allowFrom` entry

## Pairing and Allowlist State

Telegram pairing state is stored under the global `mono` state directory:

- `~/.mono/state/telegram/pairing.json`
- `~/.mono/state/telegram/allowFrom.json`

Current file roles:

- `pairing.json` stores pending DM pairing requests
- `allowFrom.json` stores approved Telegram DM sender ids

Pairing request behavior:

- codes are 8 characters
- codes use uppercase, human-friendly characters
- requests expire after 1 hour
- pending requests are capped at 3
- repeated requests from the same sender within the active window reuse the same code

Authorization behavior:

- `dmPolicy="pairing"` merges config `allowFrom` with stored approvals
- `dmPolicy="allowlist"` uses config `allowFrom` only
- group authorization does not inherit DM pairing-store approvals

## Command Surface

Telegram control is exposed through three surfaces.

### CLI

Configured in `packages/cli/src/commands/`.

Current commands:

- `mono pair telegram code <code>`
- `mono pair telegram userid <userId>`
- `mono pair telegram botid <botId>`
- `mono telegram status`
- `mono telegram token <botToken>`
- `mono telegram enable`
- `mono telegram disable`

### TUI slash commands

Configured in `packages/tui/src/slash/commands.ts` and handled in `packages/tui/src/hooks/useSlashCommands.ts`.

Current commands:

- `/pair telegram code <code>`
- `/pair telegram userid <userId>`
- `/pair telegram botid <botId>`
- `/telegram status`
- `/telegram token <botToken>`
- `/telegram enable`
- `/telegram disable`

The TUI help dialog also documents the Telegram pairing flow.

### Telegram bot commands

Processed by `processTelegramIncomingMessage()` in `packages/telegram-control/src/inbound.ts`.

Current inbound command support:

- `/help`
- `/pair telegram ...`

Authorization rules:

- unauthorized private senders do not get control commands
- unauthorized private senders in `pairing` mode receive a pairing code instead
- group `/help` is available only to configured owner-like senders

## End-to-End Pairing Flow

The intended operator flow is:

1. Save a Telegram bot token:
   - `mono telegram token <BOT_TOKEN>`
2. Launch the `mono` TUI.
3. The TUI starts `TelegramControlRuntime` if Telegram is enabled and configured.
4. A new Telegram user DMs the bot.
5. The runtime creates a pending pairing request and replies with a pairing code.
6. The operator approves the code from the platform:
   - TUI: `/pair telegram code <CODE>`
   - CLI: `mono pair telegram code <CODE>`
7. The sender id is written to the Telegram DM allowlist store.
8. If Telegram is still configured, the user receives an approval confirmation message.

Direct allowlist shortcuts also exist:

- `/pair telegram userid <USER_ID>`
- `mono pair telegram userid <USER_ID>`

These bypass pending-code lookup and directly store the approved Telegram user id.

## Runtime Flow

`TelegramControlRuntime` currently uses long polling against the Telegram Bot API.

Startup behavior:

1. resolve `mono` config
2. exit early if Telegram is disabled or missing a token
3. create a Telegram outbound distributor through `@mono/im-platform`
4. call `getMe`
5. enter a `getUpdates` polling loop

Per-message behavior:

- normalize the Telegram update into a package-local `TelegramIncomingMessage`
- for private chats:
  - merge config allowlist with stored approvals when policy is `pairing`
  - issue pairing challenges to unknown senders
  - allow `/help` and `/pair` for authorized senders
- for groups:
  - only `/help` is currently handled
  - the reply includes the current group chat id and whether the group is already configured

Outbound control replies use `@mono/im-platform` rather than duplicating Telegram send logic in the control runtime.

## TUI Integration

The TUI starts the Telegram runtime from `packages/tui/src/AppContainer.tsx`.

Current behavior:

- runtime start is attempted on app mount
- runtime notifications are surfaced as TUI toasts and status messages
- pair and Telegram slash commands execute shared service helpers and open info dialogs with the result
- slash commands that change Telegram runtime config request a runtime reload

This means the current Telegram control loop is tied to the interactive TUI process. There is no separate daemon process yet.

## Constraints

Important current constraints:

- Telegram chat execution is only available while the interactive TUI process is running
- the runtime only lives while the TUI process is running
- there is no webhook mode
- there is no group allowlist editing command yet; groups are still configured through config files
- `botId` is operator-managed config, not yet auto-written back from runtime discovery

These are current implementation limits, not hidden background behavior.

## Related Files

- `packages/telegram-control/src/config.ts`
- `packages/telegram-control/src/commands.ts`
- `packages/telegram-control/src/pairing-store.ts`
- `packages/telegram-control/src/inbound.ts`
- `packages/telegram-control/src/runtime.ts`
- `packages/cli/src/commands/pair-command.ts`
- `packages/cli/src/commands/telegram-command.ts`
- `packages/tui/src/hooks/useSlashCommands.ts`
- `packages/tui/src/components/HelpDialog.tsx`
