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
- Telegram model-menu state storage and per-sender language preference storage
- `/pair telegram ...` command execution
- `/telegram ...` command execution
- inbound Telegram command parsing for `/help`, `/pair`, `/model`, and `/cancel`
- a polling runtime that starts from the TUI and listens for Telegram messages

It does not currently own:

- webhook mode
- background daemon/service management outside the TUI process
- persistent group conversation routing
- a web control panel

The current runtime is still control-oriented, but it can now hand authorized private-chat messages off to the coding agent and stream reply previews through Telegram drafts before sending the final message.

## Package Surface

The package root is `packages/telegram-control/src/index.ts`.

Main exports:

- config helpers from `config.ts`
- pair and Telegram command handlers from `commands.ts`
- help text builders from `help.ts`
- inbound Telegram message processing from `inbound.ts`
- Telegram model menu and profile wizard helpers from `model-config.ts`
- Telegram language lookup helpers from `language.ts`
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
- `actions.send`
- `actions.sticker`
- `actions.photo`
- `actions.document`
- `actions.edit`
- `actions.delete`
- `actions.react`
- `approval.allowChats`
- `approval.commandDenylist`
- `reply.multiMessage`
- `reply.splitDelayMs`
- `reply.stickers.enabled`
- `reply.stickers.storePath`
- `dmPolicy`
- `pollingTimeoutSeconds`

Default behavior:

- Telegram is disabled by default
- DM policy defaults to `pairing`
- approval allowChats defaults to empty
- approval commandDenylist defaults to empty
- Telegram actions default to enabled for `send`, `sticker`, `edit`, `delete`, and `react`
- multi-message replies default to enabled
- reply split delay defaults to 800ms
- sticker replies default to enabled with a project-local sticker store path
- the runtime polls with a 20 second Bot API timeout

Default sticker store shape:

```json
{
  "version": 1,
  "packs": [
    {
      "id": "custom-default",
      "stickers": [
        { "emoji": "🙂", "fileId": "<telegram file_id>" }
      ]
    },
    {
      "id": "cats-pack",
      "telegramSetName": "CatsPack"
    }
  ]
}
```

Validation rules enforced during config resolution:

- `mono.channels.telegram.enabled=true` requires `botToken`
- the token must look like a Bot API token
- `botId`, when present, must be a positive numeric Telegram user id
- `dmPolicy="allowlist"` requires at least one `allowFrom` entry

Approval behavior:

- `approval.allowChats` is a Telegram chat-id allowlist for bypassing interactive tool approval
- authorized Telegram private chats also bypass interactive tool approval through `allowFrom` and stored pairing approvals
- `approval.commandDenylist` is a Telegram-scoped bash denylist checked before allowlist bypass
- destructive bash commands still hard-deny even when the chat is allowlisted

Agent tool behavior:

- Telegram DM runs can expose the generic `channel_action` tool for explicit `send` / `sticker` / `edit` / `delete` / `react` actions
- Telegram DM runs can expose `channel_action(photo|document)` to send back the current Telegram photo or document by `fileId`
- `channel_action(photo|document|sticker)` can also upload a local file path through Telegram Bot API multipart transfer, in addition to reusing an existing Telegram `fileId`
- Telegram DM runs can expose the generic `channel_store` tool for listing, searching, or persisting reusable sticker sources
- Telegram chat handoff runs in a dedicated `channel_chat` interaction mode rather than the normal coding-task mode
- `channel_chat` turns do not expose `write_todos` or the full coding toolset; allowlisted Telegram chats can expose protected `bash`, and all other native replies still go through `channel_action` / `channel_store`
- Telegram chat handoff now runs through short-lived handoff agent instances instead of borrowing the main TUI agent run slot
- those handoff agents disable automatic autonomy heartbeat and are disposed after the handoff finishes
- those handoff agents still switch into the current shared session rather than creating per-chat sessions
- handoff session switches use `preserveCurrentModel` so an older shared-session metadata header cannot override the active Telegram profile/model
- current-turn sticker metadata is injected as structured context from `TaskInput.metadata.telegram`, including `chatId`, `fileId`, `fileUniqueId`, `emoji`, `setName`, and animated/video flags
- current-turn Telegram photos and documents now keep native metadata in `TaskInput.metadata.telegram`, including `fileId`, `messageId`, `mimeType`, optional caption, and document `fileName`
- recent-history sticker recovery is scoped to the active Telegram chat id, so stickers do not bleed across chats handled by the same TUI process
- Telegram runtime keeps a global sticker search cache under `~/.mono/state/telegram/sticker-cache.json`, keyed by `fileUniqueId` when available and deduplicated by `fileId`
- `channel_store(resource="sticker_source", action="search", ...)` can search that cache and return other stickers from the same set before `channel_action(sticker)` sends one
- missing `.mono/telegram/stickers.json` blocks “save this as a default/common sticker source”, but does not block sending the current-turn sticker back when `Sticker.fileId` is available
- allowlisted Telegram private chats can receive inline approval buttons for sensitive bash commands instead of relying on the local TUI

## Pairing and Allowlist State

Telegram pairing state is stored under the global `mono` state directory:

- `~/.mono/state/telegram/pairing.json`
- `~/.mono/state/telegram/allowFrom.json`
- `~/.mono/state/telegram/model-config.json`

Current file roles:

- `pairing.json` stores pending DM pairing requests
- `allowFrom.json` stores approved Telegram DM sender ids
- `model-config.json` stores in-progress Telegram model-menu sessions and persisted per-sender language preferences
- `sticker-cache.json` stores discovered Telegram stickers for later search by `setName`, `emoji`, or description

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
- Telegram callback approvals are only honored for the original DM sender who received the approval prompt

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
- `/model`
- `/cancel`

Telegram also registers a native bot command menu at startup:

- `setMyCommands`
- `setChatMenuButton` with `MenuButtonCommands`

The menu button only opens the bot command list. Hierarchical choices such as profile selection and the second-step `Enable` / `Remove` menu are implemented with inline keyboard callback buttons, not a Telegram-native nested menu object.

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

After approval, the intended model-management flow is:

1. The user opens `/model` or the bot command menu.
2. The bot shows a model menu with two paths:
   - choose an existing profile
   - configure the shared Telegram profile
3. Existing profiles open a second-step action menu:
   - `Enable`
   - `Remove`
4. Shared-profile setup guides the user through:
   - protocol family
   - official or custom base URL
   - suggested or custom model id
   - API key capture
   - save/apply confirmation
5. The shared profile is stored as `telegram-shared` in normal mono config and local secrets.

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
5. register Telegram command-menu metadata with Bot API
6. enter a `getUpdates` polling loop

Per-message behavior:

- normalize the Telegram update into a package-local `TelegramIncomingMessage`
- for private chats:
  - merge config allowlist with stored approvals when policy is `pairing`
  - issue pairing challenges to unknown senders
  - allow `/help`, `/pair`, `/model`, and `/cancel` for authorized senders
  - resolve a per-sender UI language from Telegram `language_code` plus stored preference
  - route `/model` into the Telegram model menu
  - route existing-profile selection into a second-step action menu (`Enable` / `Remove`)
  - route shared-profile setup through a button-guided wizard with text capture where needed
- for groups:
  - only `/help` is currently handled
  - the reply includes the current group chat id and whether the group is already configured
- for authorized chat handoff:
  - model-menu traffic runs before normal chat handoff
  - the TUI creates a handoff-specific agent instance and calls it with `interactionMode: "channel_chat"`
  - the handoff-specific agent disables automatic autonomy heartbeat and is disposed after the handoff returns
  - handoff agents switch into the current shared session id so Telegram chat turns stay inside the same repository session history as the TUI
  - session switches for handoff use `preserveCurrentModel` so the shared session metadata does not silently replace the active Telegram profile/model
  - the runtime forwards Telegram channel context into the agent permission policy
  - allowlisted chats can run protected tools without approval prompts
  - authorized private chats inherit the same approval bypass through config `allowFrom` and stored pairing approvals
  - handoffs can run in parallel; the runtime no longer rejects a new chat message just because another handoff is still running
  - when the same chat sends a new message before the previous reply has finished, the TUI injects a `Channel Handoff Continuation Context` block containing the latest unfinished draft/thinking summary for that chat
  - private chats can preview streamed answer text through Bot API `sendMessageDraft`
  - the first reply segment can be materialized from the draft preview when generation completes
  - the runtime starts `typing` as soon as a chat handoff begins and keeps it alive during generation with a lightweight heartbeat
  - the runtime can still deliver one Telegram turn as multiple text messages with `typing` between later segments
  - the runtime can append one configured sticker after the text reply when the model emits a Telegram sticker tag
  - sticker-only replies are allowed; if the assistant emits only a valid sticker tag or file-id tag, the runtime sends just the sticker and does not add fallback text
  - for freshly received Telegram stickers, the normalized task input includes structured metadata under `metadata.telegram`
  - animated and video stickers are still handed off to chat as native sticker metadata even when no image attachment can be generated
  - the model can reply with `[telegram-sticker-file:<file_id>]` to send that exact sticker immediately
  - sticker delivery can use:
    - the current sticker `fileId`
    - the project-local JSON store (`mono.channels.telegram.reply.stickers.storePath`)
    - the global Telegram sticker search cache
  - reasoning/thinking content is separated from visible assistant text before the final reply is assembled, so `<think>`-style wrapper content does not leak into Telegram messages
  - the default store path is `.mono/telegram/stickers.json`
  - each store pack can either point at a Telegram sticker set or embed concrete `emoji -> fileId` entries that the agent can edit later
  - when the user asks for another sticker from the same set, the preferred flow is:
    1. `channel_store(resource="sticker_source", action="search", entry={ setName, excludeFileId })`
    2. choose a different `fileId`
    3. `channel_action(action="sticker", payload.fileId=...)`
  - if draft transport is unavailable or rejected, delivery falls back to the normal final-message path

Outbound control replies use `@mono/im-platform` rather than duplicating Telegram send logic in the control runtime.

## TUI Integration

The TUI starts the Telegram runtime from `packages/tui/src/AppContainer.tsx`.

Current behavior:

- runtime start is attempted on app mount
- runtime notifications are surfaced as TUI toasts and status messages
- the TUI registers the Telegram runtime as a channel capability provider backing the generic `channel_action` and `channel_store` tools
- Telegram chat handoff now uses short-lived parallel handoff agents that switch into the current shared session instead of reusing the main interactive run slot
- those handoff agents disable automatic autonomy heartbeat and are disposed after the handoff completes
- pair and Telegram slash commands execute shared service helpers and open info dialogs with the result
- slash commands that change Telegram runtime config request a runtime reload
- the Telegram runtime receives `listConfiguredProfiles`, `applyProfile`, and busy-state callbacks from the TUI container
- profile application from Telegram now refreshes the registry before listing or applying profiles
- pending profile application is flushed after `run-end` and `run-aborted`

This means the current Telegram control loop is tied to the interactive TUI process. There is no separate daemon process yet.

## Constraints

Important current constraints:

- Telegram chat execution is only available while the interactive TUI process is running
- the runtime only lives while the TUI process is running
- there is no webhook mode
- there is no group allowlist editing command yet; groups are still configured through config files
- `botId` is operator-managed config, not yet auto-written back from runtime discovery
- the current localization scope is Telegram-only and stored inside `@mono/telegram-control`
- Telegram model-menu language selection is persisted per sender, but other mono surfaces are not yet localized through the same mechanism

These are current implementation limits, not hidden background behavior.

## Related Files

- `packages/telegram-control/src/config.ts`
- `packages/telegram-control/src/commands.ts`
- `packages/telegram-control/src/language.ts`
- `packages/telegram-control/src/model-config.ts`
- `packages/telegram-control/src/pairing-store.ts`
- `packages/telegram-control/src/inbound.ts`
- `packages/telegram-control/src/runtime.ts`
- `packages/cli/src/commands/pair-command.ts`
- `packages/cli/src/commands/telegram-command.ts`
- `packages/tui/src/hooks/useSlashCommands.ts`
- `packages/tui/src/components/HelpDialog.tsx`
