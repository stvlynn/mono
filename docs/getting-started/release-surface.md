# Release Surface

## Purpose

This document defines the user-facing and maintainer-facing surfaces that matter when assessing whether a change is release-worthy.

## Primary Release Surfaces

### CLI

- `mono`
- `mono auth`
- `mono config`
- `mono models`
- `mono memory`
- `--print`
- `--continue`

### TUI

- interactive prompt submission
- slash commands
- dialogs
- approval flow
- key handling and interrupt behavior
- status/footer/task tray rendering

### Runtime

- task execution and verification behavior
- memory-backed todo planning
- session append/replay/branch switching
- prompt rendering
- tool scheduling and permissions

## Compatibility Expectations

A change is release-sensitive if it affects:

- config layout under `~/.mono`
- session file shape or replay semantics
- `RuntimeEvent` semantics consumed by the TUI
- provider request formatting
- tool result ordering

## Non-Release-Surface Internals

These may still matter operationally, but are lower-risk if contracts stay stable:

- helper functions inside `shared`
- internal formatting helpers
- purely presentational waiting-copy template wording
