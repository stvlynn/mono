# API Reference: `@mono/session`

## Purpose

Describe the `SessionManager` contract.

## Main Type

`SessionManager` in `packages/session/src/session-manager.ts`

## Responsibilities

- initialize a session file
- append entries
- preserve and expose the active head
- replay reachable messages
- checkout a branch head
- list nodes and branch heads

## Important Behaviors

- explicit `branchHeadId` is preserved on initialization
- unknown branch heads throw
- replay is ancestry-based, not simple file slicing
