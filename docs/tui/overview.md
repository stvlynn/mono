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
