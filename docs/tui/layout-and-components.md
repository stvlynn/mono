# TUI Layout and Components

## Main Regions

The active local `tui` surface is now generated through json-render. The model composes adapter-owned regions rather than one fixed React tree.

- `HeaderBar`
- `HistoryPane`
- `PendingToolsPane`
- `PendingAssistantPane`
- `TodoPanel`
- `StatusPanel`
- `ContextUsagePanel`
- `ToastStack`
- `InputPanel`
- `FooterBar`
- `DialogLayer`

## Supporting Components

- `AppHeader`
- `HistoryItemDisplay`
- `TodoTray`
- `StatusDisplay`
- `ToastDisplay`
- `ContextUsageDisplay`
- `InputPrompt`
- `SessionBrowser`
- `ApprovalDialog`
- `ListDialog`

## Rendering Modes

- `mono.channels.tui.specMode = "deterministic"` keeps the static fallback layout
- `mono.channels.tui.specMode = "generative"` uses the current active model to stream json-render Ink SpecStream patches from the presentation state
