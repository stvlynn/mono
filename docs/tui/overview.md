# TUI Overview

## Purpose

Describe the current interactive UI architecture.

## Main Composition

The active TUI is an Ink host rendered through `@json-render/ink` and centered on:

- `AppContainer` as runtime/controller
- `JsonRenderTui` as the json-render host
- adapter-owned catalog/registry/spec generation in `packages/tui/src/json-render-tui.tsx`
- adapter/integration registration in `packages/tui/src/channel-registry.ts`

## Main Responsibilities

- map runtime events into visible state
- convert local UI state into a validated json-render Ink spec
- render the interactive surface through json-render custom components
- manage dialogs, input, and approvals through adapter-owned components

## Telegram Integration

`AppContainer` now attaches channel integrations through the local channel registry instead of constructing Telegram directly.

Current behavior:

- resolve the `tui` surface through the local channel registry
- attach registered integrations such as Telegram through adapter handles
- compose channel capability providers from attached integrations
- hand authorized Telegram private-chat messages to short-lived handoff agent instances instead of the main interactive run slot
- disable automatic autonomy heartbeat on those handoff agent instances and dispose them after each handoff completes
- switch those handoff agents into the current shared session id
- force Telegram chat handoff into `interactionMode: "channel_chat"`
- preserve the current Telegram model/profile when switching that shared session for handoff
- keep one unfinished draft/thinking lane per Telegram chat and inject it as continuation context into the next message from the same chat

## Channel Registration

The local TUI is now registered as a channel surface type:

- `tui` is the default local surface channel
- `telegram` remains a remote integration attached through the same registry
- adapter-specific startup and reload logic lives under `packages/tui/src/integrations/`
- adapter-external code should not branch on concrete channel ids unless it is config or documentation

`channel_chat` turns differ from the normal coding-task path:

- they do not expose `write_todos` or the full coding toolset; allowlisted Telegram chats can still receive protected `bash`
- they keep replies in the channel-delivery path
- they rely on `channel_action` / `channel_store` for native Telegram sends such as stickers
- streamed assistant text is sanitized before Telegram draft preview updates
- multiple Telegram handoffs can run in parallel without blocking the local TUI coding run
