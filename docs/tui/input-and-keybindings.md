# Input and Keybindings

## Purpose

Describe the raw input path and current key semantics.

## Input Stack

- `useRawKeypress()` reads terminal input directly
- `createRawKey()` normalizes common sequences
- `InputBuffer` stores text, cursor position, and history
- `InputPrompt` maps normalized keys to editing or actions
- `AppContainer` stores pending image attachments for the next submission

## Important Key Behaviors

- `Enter`: submit when either text or pending images exist
- `Ctrl+J` or `Shift+Enter`: newline
- Backspace/Delete: delete text with terminal compatibility helpers
- slash commands: filtered inline in the composer
- `Ctrl+C`: handled by the centralized interrupt controller

## Image Commands

Current TUI image commands:

- `/attach <path>`
- `/detach [index|name|all]`
- `/attachments`

The composer renders a compact pending-attachment list above the input buffer so users can verify what will be sent on the next turn.

## Compatibility Notes

The raw key layer exists because terminal key sequences are not stable enough to rely only on high-level Ink input semantics.
