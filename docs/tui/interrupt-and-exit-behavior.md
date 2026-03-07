# Interrupt and Exit Behavior

## Purpose

Describe the centralized `Ctrl+C` behavior in the TUI.

## Current Rules

Priority order:

1. close or deny the top dialog
2. abort the active run
3. clear draft input
4. arm exit while idle

## Repeated Press Behavior

`Ctrl+C` is handled through an interrupt controller with a repeat window.

Typical flow:

- first press interrupts the current context
- a quick second press exits the app

## Why This Exists

This avoids scattering exit logic across input components and makes behavior closer to Gemini CLI-style repeated-key semantics.
