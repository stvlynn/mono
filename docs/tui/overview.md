# TUI Overview

## Purpose

Describe the current interactive UI architecture.

## Main Composition

The active TUI is Ink-based and centered on:

- `AppContainer`
- `RootApp`
- `MainContent`
- `Composer`
- `DialogManager`

## Main Responsibilities

- render runtime history
- render pending assistant/tool state
- manage dialogs
- collect and edit input
- map runtime events into visible state

## Telegram Integration

`AppContainer` also owns Telegram runtime startup and chat handoff wiring.

Current behavior:

- start `TelegramControlRuntime` when Telegram is configured
- register the Telegram runtime as the current channel capability provider
- hand authorized Telegram private-chat messages to short-lived handoff agent instances instead of the main interactive run slot
- switch those handoff agents into the current shared session id
- force Telegram chat handoff into `interactionMode: "channel_chat"`
- preserve the current Telegram model/profile when switching that shared session for handoff
- keep one unfinished draft/thinking lane per Telegram chat and inject it as continuation context into the next message from the same chat

`channel_chat` turns differ from the normal coding-task path:

- they do not expose coding tools or `write_todos`
- they keep replies in the channel-delivery path
- they rely on `channel_action` / `channel_store` for native Telegram sends such as stickers
- streamed assistant text is sanitized before Telegram draft preview updates
- multiple Telegram handoffs can run in parallel without blocking the local TUI coding run
