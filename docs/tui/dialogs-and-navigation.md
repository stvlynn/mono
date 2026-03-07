# Dialogs and Navigation

## Dialog Types

Current dialogs include:

- help
- info
- approval
- list-based dialogs for model/profile/session/memory/tree
- session browser specialization

## Navigation Model

- dialogs are stacked in UI state
- the top-most dialog is active
- `Esc` closes the top dialog
- `Ctrl+C` also closes or denies the current front-most dialog before exit is considered
