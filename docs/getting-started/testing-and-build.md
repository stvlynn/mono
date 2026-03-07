# Testing and Build

## Purpose

This document explains how the repository is validated and what the current automated coverage does and does not guarantee.

## Build Pipeline

The root build command is:

```bash
pnpm build
```

It currently performs:

1. `tsc -b` across the workspace
2. asset copying for prompt templates via `scripts/copy-workspace-assets.mjs`

## Test Suite

The root test command is:

```bash
pnpm test
```

The suite covers:

- task runtime behavior
- agent behavior and abort semantics
- session manager behavior
- config resolution
- memory store behavior
- tool batch scheduling
- raw keypress compatibility
- waiting-copy state transitions
- slash command logic

## Manual Validation Still Required

Automated tests do not fully replace manual terminal validation for:

- real TTY key handling
- alternate buffer behavior
- dialog stacking/focus behavior
- provider-specific streaming/tool-call quirks

## Recommended Smoke Checks

Run these before shipping major changes:

```bash
pnpm test
pnpm build
node packages/cli/dist/bin.js --help
node packages/cli/dist/bin.js models
node packages/cli/dist/bin.js --print "read package.json and summarize it"
```

## High-Risk Areas To Validate Manually

- `Ctrl+C` behavior in the TUI
- approval dialogs
- session switching while idle
- tool-call/result sequencing against providers
- long tasks that trigger session compression
