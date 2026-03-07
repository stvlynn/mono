# Input and Keybindings

## Purpose

Describe the raw input path and current key semantics.

## Input Stack

- `useRawKeypress()` reads terminal input directly
- `createRawKey()` normalizes common sequences
- `InputBuffer` stores text, cursor position, and history
- `InputPrompt` maps normalized keys to editing or actions

## Important Key Behaviors

- `Enter`: submit
- `Ctrl+J` or `Shift+Enter`: newline
- Backspace/Delete: delete text with terminal compatibility helpers
- slash commands: filtered inline in the composer
- `Ctrl+C`: handled by the centralized interrupt controller

## Compatibility Notes

The raw key layer exists because terminal key sequences are not stable enough to rely only on high-level Ink input semantics.
