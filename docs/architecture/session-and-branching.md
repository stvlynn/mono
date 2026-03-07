# Session and Branching

## Purpose

Describe how `mono` persists conversations and supports branch checkout.

## Storage Format

Sessions are stored as append-only JSONL files under `~/.mono/sessions/<cwd-slug>/<sessionId>.jsonl`.

## SessionManager Responsibilities

`packages/session/src/session-manager.ts` owns:

- session initialization
- appending messages and metadata entries
- preserving the current branch head
- loading messages reachable from a selected head
- listing nodes and branch heads

## Branch Model

Each entry stores:

- `id`
- optional `parentId`
- `entryType`
- `payload`
- timestamp

A branch checkout changes the active `headId` and replay walks parent links back to the root.

## Important Invariants

- an explicitly requested branch head is preserved during initialization
- unknown branch heads now fail explicitly
- switching sessions or branches must also refresh current task/todo state at the agent layer

## Non-Message Entries

The session store also records:

- `memory_reference`
- `memory_record`
- `task_state` for legacy compatibility
- `task_pointer`
- `task_summary`
- `session_compression`
